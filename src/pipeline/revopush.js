import { resolve } from 'node:path'
import { ReleaseError } from '../lib/errors.js'
import { capture } from '../lib/exec.js'
import { info, planned, task } from '../lib/ui.js'
import { readXcodeTargets, resolveIosVersion } from '../lib/xcode.js'
import { confirmAction, soften, stream } from './stream.js'

const MAX_ACCOUNT_CHARS = 60

/**
 * The release-react argv, built from config and answers. Optional flags are omitted when blank.
 * xcodeTarget (--xt) is only for an iOS project whose version is a variable RevoPush must resolve.
 */
export function revopushArgs({ app, platform, environment, version, xcodeTarget, description }) {
  return [
    'release-react',
    app.name,
    platform,
    '-d',
    environment,
    ...(version ? ['-t', version] : []),
    ...(xcodeTarget ? ['--xt', xcodeTarget] : []),
    ...(description ? ['--des', description] : []),
  ]
}

/**
 * With no version typed, RevoPush reads one from the native project. On iOS that is
 * MARKETING_VERSION of "some" Xcode target, and a project with extensions can answer with the wrong
 * one. So rnmrs reads the project itself: it uses the target set under xcode_targets, passes the
 * version explicitly, and stops when targets disagree and nothing says which is the app.
 */
async function releaseVersion(ctx) {
  const { config, projectRoot, answers } = ctx
  if (answers.platform !== 'ios' || answers.version) return { version: answers.version, xcodeTarget: '' }

  const resolved = await soften(ctx, async () => {
    const targets = readXcodeTargets(resolve(projectRoot, config.fastlane.ios.path))
    if (!targets) return {} // No project to read (or none found): leave it to RevoPush, as before.
    return resolveIosVersion({ targets, xcodeTarget: answers.app.xcodeTargets?.[answers.environment.toLowerCase()] })
  })
  if (!resolved) return null

  if (resolved.via) info(`Release version: ${resolved.version ?? 'read by RevoPush'} (${resolved.via})`)
  return { version: resolved.version ?? '', xcodeTarget: resolved.xcodeTarget ?? '' }
}

/** Step 3 for `revopush`: verify the CLI and login, then release. */
export async function runRevopush(ctx) {
  const { projectRoot, answers, tools, flags } = ctx

  if (!tools.revopush?.found) {
    throw new ReleaseError('The revopush CLI is not installed.', { hint: 'Install the RevoPush CLI and make sure "revopush" is on your PATH.' })
  }

  const target = await releaseVersion(ctx)
  if (!target) return { released: false } // dry run: the problem was reported, nothing more to preview

  if (flags.dryRun) {
    planned('Verifying RevoPush login', 'revopush whoami')
  } else {
    await task('Verifying RevoPush login', async () => {
      const res = await capture('revopush', ['whoami'], { cwd: projectRoot, env: ctx.childEnv })
      if (res.code !== 0) {
        throw new ReleaseError('Not logged in to RevoPush, or the session has expired.', {
          hint: 'Run "revopush login", then retry.',
          output: res.stderr || res.stdout,
        })
      }
      const account = res.stdout.split('\n').map((l) => l.trim()).find(Boolean) ?? ''
      return account.length > MAX_ACCOUNT_CHARS ? `${account.slice(0, MAX_ACCOUNT_CHARS)}...` : account
    })
  }

  // Production is the one deployment where a wrong flag reaches every user, so it always asks.
  if (answers.environment.toLowerCase() === 'production') {
    const label = `${answers.app.name} (${answers.platform})`
    if (!(await confirmAction(ctx, `Release to PRODUCTION for ${label}?`))) return { released: false }
  }

  await stream(ctx, 'RevoPush release', 'revopush', revopushArgs({ ...answers, ...target }), { cwd: projectRoot })
  return { released: true }
}
