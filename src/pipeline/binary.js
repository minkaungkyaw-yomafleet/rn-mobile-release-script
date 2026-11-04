import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ignoresVersion, laneCommand, resolveLanes } from '../fastlane/lanes.js'
import { ReleaseError } from '../lib/errors.js'
import { capture, formatCommand } from '../lib/exec.js'
import { checkFastlaneEnv, readLanes } from '../lib/native.js'
import { info, task, warn } from '../lib/ui.js'
import { assertCanConfirm, check, confirmAction, soften, stream } from './stream.js'

const SAMPLE_KEYS = 5

/**
 * Step 3 for `binary`: verify Fastlane and its credentials, resolve the build/release lanes,
 * build, ask, release. Returns { released }.
 */
export async function runBinary(ctx) {
  const { projectRoot, config, answers, tools } = ctx
  const dir = resolve(projectRoot, config.fastlane[answers.platform].path)
  const fastfile = join(dir, 'fastlane', 'Fastfile')
  if (!existsSync(fastfile)) {
    throw new ReleaseError(`No Fastfile at ${fastfile}.`, { hint: `Check fastlane.${answers.platform}.path in rnmrs.config.yml.` })
  }

  const gemfile = existsSync(join(dir, 'Gemfile')) || existsSync(join(projectRoot, 'Gemfile'))
  if (gemfile && !tools.bundle?.found) {
    throw new ReleaseError('This project pins Fastlane in a Gemfile but Bundler is not installed.', { hint: 'Run "gem install bundler", then "bundle install".' })
  }
  const bundler = gemfile

  await check(ctx, 'Checking Fastlane installation', async () => {
    if (bundler) {
      const res = await capture('bundle', ['check'], { cwd: dir, env: ctx.childEnv })
      if (res.code !== 0) {
        // bundle check lists every missing gem (often 100+ lines); the count is the useful part.
        const combined = `${res.stdout}\n${res.stderr}`
        const missing = combined.split('\n').filter((l) => /^\s*\* /.test(l)).length
        const what = missing > 0 ? `${missing} gems from the Gemfile are not installed` : 'The Gemfile gems are not installed'
        throw new ReleaseError(`${what}.`, { hint: `Run "bundle install" in ${dir}.`, output: missing > 0 ? '' : combined })
      }
      return 'bundle exec fastlane'
    }
    if (!tools.fastlane?.found) {
      throw new ReleaseError('Fastlane is not installed.', { hint: 'Run "brew install fastlane", or add it to a Gemfile and run "bundle install".' })
    }
    return tools.fastlane.path
  })

  await check(ctx, 'Checking Fastlane credentials', async () => {
    const res = await checkFastlaneEnv(dir)
    if (res.missingPathVars.length > 0) {
      throw new ReleaseError(`Credential files are missing for: ${res.missingPathVars.join(', ')}.`, {
        hint: `These variables in ${dir}/fastlane/.env point at files that do not exist.`,
      })
    }
    const warnings = []
    if (!res.envFile) {
      warnings.push(
        res.exampleOnly
          ? 'fastlane/.env not found (only .env.example). Copy it and fill it in, or export the variables.'
          : 'fastlane/.env not found; relying on exported environment variables.',
      )
    } else if (res.emptyKeys.length > 0) {
      const sample = res.emptyKeys.slice(0, SAMPLE_KEYS).join(', ')
      warnings.push(`fastlane/.env has ${res.emptyKeys.length} blank variable(s): ${sample}${res.emptyKeys.length > SAMPLE_KEYS ? ', ...' : ''}`)
    }
    return { detail: res.envFile ? `${res.keyCount} variables` : 'no .env', warnings }
  })

  // Discovery runs behind a spinner; lane choice (which may prompt) runs after it, never inside.
  let discovered = []
  let defaultPlatform = ''
  if (config.fastlane.autoInitialize) {
    await task('Reading Fastlane lanes', async () => {
      const res = await readLanes(dir)
      discovered = res.lanes
      defaultPlatform = res.defaultPlatform ?? ''
      return `${discovered.filter((l) => !l.private).length} lanes in ${fastfile.replace(`${projectRoot}/`, '')}`
    })
  }
  const configured = config.fastlane.lanes[answers.platform]?.[answers.environment.toLowerCase()]
  const lanes = await soften(ctx, () =>
    resolveLanes({
      discovered,
      configured,
      platform: answers.platform,
      env: answers.environment,
      interactive: ctx.interactive,
    }),
  )
  if (!lanes) return { released: false }
  if (lanes.release || lanes.single) assertCanConfirm(ctx)

  const planText = lanes.single
    ? `${lanes.single.name} (build and release)`
    : [lanes.build && `build: ${lanes.build.name}`, lanes.release && `release: ${lanes.release.name}`].filter(Boolean).join(', ')
  info(`Lanes: ${planText}`)

  const run = (label, lane) => {
    if (ignoresVersion(lane, answers.version)) warn(`Lane ${lane.name} does not read options[:version]; ${answers.version} is not passed to it.`)
    const { cmd, args } = laneCommand({ lane, defaultPlatform, version: answers.version, bundler })
    return { label, cmd, args }
  }
  const runStep = ({ label, cmd, args }) => stream(ctx, label, cmd, args, { cwd: dir })

  if (lanes.single) {
    const single = run('Fastlane build and release', lanes.single)
    if (!(await confirmAction(ctx, `Lane ${lanes.single.name} builds and releases in one go. Proceed?`))) return { released: false }
    await runStep(single)
    return { released: true }
  }

  if (lanes.build) await runStep(run('Fastlane build', lanes.build))

  if (!lanes.release) {
    warn('No release lane matched this environment; the build is done and nothing was released.')
    return { released: false }
  }
  const release = run('Fastlane release', lanes.release)
  if (!(await confirmAction(ctx, 'Do you want to proceed with the release?'))) {
    info(`Release skipped. To release later: (cd ${dir} && ${formatCommand(release.cmd, release.args)})`)
    return { released: false }
  }
  await runStep(release)
  return { released: true }
}
