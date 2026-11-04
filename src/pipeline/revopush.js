import { ReleaseError } from '../lib/errors.js'
import { capture } from '../lib/exec.js'
import { planned, task } from '../lib/ui.js'
import { confirmAction, stream } from './stream.js'

const MAX_ACCOUNT_CHARS = 60

/** The release-react argv, built from config and answers. Optional flags are omitted when blank. */
export function revopushArgs({ app, platform, environment, version, description }) {
  return [
    'release-react',
    app.name,
    platform,
    '-d',
    environment,
    ...(version ? ['-t', version] : []),
    ...(description ? ['--des', description] : []),
  ]
}

/** Step 3 for `revopush`: verify the CLI and login, then release. */
export async function runRevopush(ctx) {
  const { projectRoot, answers, tools, flags } = ctx

  if (!tools.revopush?.found) {
    throw new ReleaseError('The revopush CLI is not installed.', { hint: 'Install the RevoPush CLI and make sure "revopush" is on your PATH.' })
  }

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
    const target = `${answers.app.name} (${answers.platform})`
    if (!(await confirmAction(ctx, `Release to PRODUCTION for ${target}?`))) return { released: false }
  }

  await stream(ctx, 'RevoPush release', 'revopush', revopushArgs(answers), { cwd: projectRoot })
  return { released: true }
}
