import { confirm } from '@inquirer/prompts'
import chalk from 'chalk'
import { ReleaseError } from '../lib/errors.js'
import { formatCommand, inherit } from '../lib/exec.js'
import { icon, note, planned, task } from '../lib/ui.js'

/**
 * Runs a read-only verification. In --dry-run a failure is recorded and reported, and the
 * preview carries on, so one dry run shows every problem a real run would hit. Outside
 * dry-run the error propagates as usual. Returns undefined when it was softened.
 */
export async function soften(ctx, fn) {
  try {
    return await fn()
  } catch (error) {
    if (!ctx.flags.dryRun || !(error instanceof ReleaseError)) throw error
    ctx.problems.push(error.message)
    console.log(`${icon.warn} Would stop a real run: ${error.message}`)
    // The detail (for example which Xcode targets disagree) is what makes the problem fixable.
    for (const line of (error.output ?? '').trim().split('\n').filter(Boolean).slice(-10)) note(line)
    if (error.hint) note(error.hint)
    return undefined
  }
}

/** A read-only verification behind a spinner; see soften(). */
export const check = (ctx, title, fn) => soften(ctx, () => task(title, fn))

/** A mutating step behind a spinner; in --dry-run it is only described. */
export async function step(ctx, title, command, fn) {
  if (ctx.flags.dryRun) {
    planned(title, command)
    return
  }
  await task(title, fn)
}

/**
 * Runs the tool that does the real work (Fastlane, RevoPush) with the terminal attached, so
 * its progress shows live and any question it asks (2FA code, password, lane option) reaches
 * the developer. No spinner here: it would fight the tool for the TTY.
 */
export async function stream(ctx, label, cmd, args, { cwd }) {
  const line = formatCommand(cmd, args)
  if (ctx.flags.dryRun) {
    planned(label, `${line}  (in ${cwd})`)
    return
  }
  console.log(`\n${chalk.bold.cyan('▶')} ${chalk.bold(label)} ${chalk.dim(`$ ${line}`)}\n`)
  const code = await inherit(cmd, args, { cwd, env: ctx.childEnv })
  if (code !== 0) {
    throw new ReleaseError(`${label} failed (exit code ${code}).`, { hint: 'The tool output above has the details.' })
  }
  console.log(`\n${icon.ok} ${label}`)
}

/**
 * Fails fast when a confirmation will be needed but nobody can give it. Call this before
 * any slow step (a build) so an unattended run without --yes does not work for twenty
 * minutes and only then stop at the release prompt.
 */
export function assertCanConfirm(ctx) {
  if (ctx.flags.yes || ctx.flags.dryRun || ctx.interactive) return
  throw new ReleaseError('This release needs a confirmation but the session is not interactive.', { hint: 'Pass --yes to release without a prompt.' })
}

/**
 * Gate for outward-facing actions. --yes answers it; otherwise a person must. A session
 * with no terminal and no --yes fails instead of releasing unattended by accident.
 */
export async function confirmAction(ctx, message) {
  if (ctx.flags.yes || ctx.flags.dryRun) return true
  assertCanConfirm(ctx)
  return confirm({ message, default: true })
}
