import chalk from 'chalk'
import { ReleaseError } from '../lib/errors.js'
import { assertCore } from '../lib/native.js'
import { heading, icon, warn } from '../lib/ui.js'
import { runBinary } from './binary.js'
import { installDependencies, precheck } from './checks.js'
import { runRevopush } from './revopush.js'
import { assertCanConfirm } from './stream.js'

/**
 * ctx: { config, projectRoot, answers, flags, interactive }, plus tools / pm / envFile /
 * childEnv filled in by the steps as they run.
 */
export async function runPipeline(ctx) {
  ctx.problems = []
  // A production OTA release always asks; fail now rather than after the install if nobody can answer.
  if (ctx.answers.type === 'revopush' && ctx.answers.environment.toLowerCase() === 'production') assertCanConfirm(ctx)
  await assertCore()

  heading(1, 3, 'Pre-checks and cleaning')
  await precheck(ctx)

  heading(2, 3, 'Dependencies')
  await installDependencies(ctx)

  const isBinary = ctx.answers.type === 'binary'
  heading(3, 3, isBinary ? 'Fastlane build and release' : 'RevoPush release')
  const { released } = isBinary ? await runBinary(ctx) : await runRevopush(ctx)

  if (ctx.flags.dryRun && ctx.problems.length > 0) {
    // Non-zero exit so a dry run can gate a CI job: these problems would stop a real release.
    throw new ReleaseError(`Dry run found ${ctx.problems.length} problem(s) that would stop a real release.`, {
      hint: 'Nothing was installed, built or released.',
    })
  }
  console.log('')
  if (ctx.flags.dryRun) console.log(`${icon.planned} ${chalk.bold('Dry run finished.')} Nothing was installed, built or released.`)
  else if (released) console.log(`${icon.ok} ${chalk.bold.green('Release complete.')}`)
  else warn(chalk.bold('Stopped before releasing.'))
}
