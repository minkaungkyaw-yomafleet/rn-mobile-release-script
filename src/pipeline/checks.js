import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import chalk from 'chalk'
import { envFileFor } from '../config/schema.js'
import { ReleaseError } from '../lib/errors.js'
import { capture, formatCommand, utf8Env } from '../lib/exec.js'
import { checkEnvFile, cleanProject, preflight } from '../lib/native.js'
import { detectPackageManager, fallbackPackageManager, installCommand, majorOf } from '../lib/pm.js'
import { formatBytes, note, task } from '../lib/ui.js'
import { check, step } from './stream.js'

const SAMPLE_KEYS = 5

function wantedTools({ type, platform }) {
  const tools = new Set(['bun', 'yarn', 'npm'])
  if (type === 'binary') ['fastlane', 'bundle'].forEach((t) => tools.add(t))
  if (platform === 'ios') ['pod', 'bundle'].forEach((t) => tools.add(t))
  if (type === 'revopush') tools.add('revopush')
  return [...tools]
}

const hasGemfile = (...dirs) => dirs.some((dir) => existsSync(join(dir, 'Gemfile')))

/** Step 1: toolchain, package manager, env file, caches. Fills ctx.tools, ctx.pm, ctx.childEnv. */
export async function precheck(ctx) {
  const { projectRoot, config, answers, flags } = ctx

  if (answers.platform === 'ios' && process.platform !== 'darwin') {
    throw new ReleaseError('iOS releases need macOS.', { hint: 'Run this on a Mac, or choose android.' })
  }
  // Locale fix-up applies from the start; ENVFILE is added once the env file checks out.
  ctx.childEnv = utf8Env()

  await task('Checking toolchain', async () => {
    const res = await preflight(projectRoot, wantedTools(answers))
    ctx.tools = res.tools
    return Object.entries(res.tools)
      .filter(([, t]) => t.found)
      .map(([name]) => name)
      .join(', ')
  })

  await task('Detecting package manager', async () => {
    const detected = detectPackageManager(projectRoot)
    const name = detected.name ?? fallbackPackageManager(ctx.tools)
    const tool = name ? ctx.tools[name] : null
    if (!tool?.found) {
      throw new ReleaseError(`${name ?? 'No package manager'} is not installed.`, { hint: 'Install bun, yarn or npm (the one your lockfile belongs to).' })
    }
    ctx.pm = { name, major: majorOf(tool.version) }
    const why = detected.name ? detected.source : 'no lockfile, using the first one installed'
    return `${name} ${tool.version ?? ''} (${why})`.replace('  ', ' ')
  })

  await check(ctx, `Checking env file for ${answers.environment}`, async () => {
    const entry = envFileFor(config, answers.environment)
    if (!entry) {
      const target = answers.environment.toLowerCase()
      throw new ReleaseError(`No env_files entry maps to "${answers.environment}".`, {
        hint: `Add { path: .env.${target}, target: ${target} } to env_files in rnmrs.config.yml.`,
      })
    }
    const res = await checkEnvFile(projectRoot, entry.path)
    if (!res.exists) {
      throw new ReleaseError(`${entry.path} is missing.`, {
        hint: 'Without it the build can silently fall back to the wrong .env. Get the file for this environment from your team, then retry.',
      })
    }
    if (!res.nonEmpty) throw new ReleaseError(`${entry.path} is empty.`, { hint: 'Fill it in or fetch the real file for this environment.' })

    // react-native-config and the Gradle scripts read ENVFILE; this pins the mapped file for every child process.
    ctx.envFile = entry.path
    ctx.childEnv = { ...ctx.childEnv, ENVFILE: entry.path }

    const warnings = []
    if (res.emptyKeys.length > 0) {
      const sample = res.emptyKeys.slice(0, SAMPLE_KEYS).join(', ')
      const more = res.emptyKeys.length > SAMPLE_KEYS ? `, +${res.emptyKeys.length - SAMPLE_KEYS} more` : ''
      warnings.push(`${entry.path} has ${res.emptyKeys.length} blank variable(s): ${sample}${more}`)
    }
    return { detail: `${entry.path} (${res.keyCount} variables)`, warnings }
  })

  if (flags.clean === false) {
    note('Skipping cache and build cleanup (--no-clean).')
    return
  }
  let cleaned
  await task('Cleaning caches and build output', async () => {
    cleaned = await cleanProject(projectRoot, answers.platform, { dryRun: Boolean(flags.dryRun) })
    const verb = flags.dryRun ? 'would free' : 'freed'
    return `${verb} ${formatBytes(cleaned.totalBytes)}`
  })
  if (flags.dryRun) {
    for (const e of cleaned.entries.filter((e) => e.status === 'would-remove')) note(`would remove ${e.path} (${formatBytes(e.bytes)})`)
  }
  for (const e of cleaned.entries.filter((e) => e.status === 'error')) note(chalk.yellow(`could not remove ${e.path}: ${e.detail}`))
}

/** Step 2: JS dependencies, then CocoaPods for iOS. */
export async function installDependencies(ctx) {
  const { projectRoot, config, answers } = ctx
  const [cmd, ...args] = installCommand(ctx.pm.name, ctx.pm.major)
  const command = formatCommand(cmd, args)

  await step(ctx, 'Installing dependencies', command, async () => {
    const res = await capture(cmd, args, { cwd: projectRoot, env: ctx.childEnv })
    if (res.code !== 0) {
      throw new ReleaseError(`${command} failed (exit code ${res.code}).`, {
        output: `${res.stdout}\n${res.stderr}`,
        hint: `If the lockfile is out of date, run "${ctx.pm.name} install" locally and commit it. Releases never rewrite it.`,
      })
    }
    return command
  })

  if (answers.platform !== 'ios') return

  const iosDir = resolve(projectRoot, config.fastlane.ios.path)
  const bundler = hasGemfile(iosDir, projectRoot) && ctx.tools.bundle?.found
  if (!bundler && !ctx.tools.pod?.found) {
    throw new ReleaseError('CocoaPods is not installed.', { hint: 'Run "brew install cocoapods", or add it to the Gemfile and run "bundle install".' })
  }
  const podCmd = bundler ? ['bundle', 'exec', 'pod', 'install'] : ['pod', 'install']
  const podCommand = formatCommand(podCmd[0], podCmd.slice(1))

  await step(ctx, 'Installing pods', `${podCommand}  (in ${iosDir})`, async () => {
    const res = await capture(podCmd[0], podCmd.slice(1), { cwd: iosDir, env: ctx.childEnv })
    if (res.code !== 0) {
      throw new ReleaseError(`${podCommand} failed (exit code ${res.code}).`, { output: `${res.stdout}\n${res.stderr}` })
    }
    return podCommand
  })
}
