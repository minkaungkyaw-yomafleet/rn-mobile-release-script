import chalk from 'chalk'
import { ReleaseError } from './errors.js'

// In-house spinner: ora stalls under Bun 1.4 on a TTY (verified: even ora.start() then a plain
// await never resumes), while a bare interval writing to stderr is fine. Animates only on a TTY;
// otherwise it stays silent and the final line is all that is printed.
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const HIDE_CURSOR = '\x1b[?25l'
const SHOW_CURSOR = '\x1b[?25h'
const CLEAR_LINE = '\r\x1b[2K'

function createSpinner(initialText) {
  const tty = Boolean(process.stderr.isTTY)
  let text = initialText
  let frame = 0
  let timer = null
  const draw = () => process.stderr.write(`${CLEAR_LINE}${chalk.cyan(FRAMES[frame++ % FRAMES.length])} ${text}`)
  const restore = () => process.stderr.write(SHOW_CURSOR)
  const onSigint = () => {
    stop()
    process.exit(130)
  }
  function stop() {
    if (!timer) return
    clearInterval(timer)
    timer = null
    process.stderr.write(CLEAR_LINE)
    restore()
    process.off('SIGINT', onSigint)
    process.off('exit', restore)
  }
  if (tty) {
    process.stderr.write(HIDE_CURSOR)
    process.on('exit', restore)
    process.on('SIGINT', onSigint)
    draw()
    timer = setInterval(draw, 80)
  }
  return {
    setText(next) {
      text = next
    },
    /** Replaces the spinner line with a final "symbol text" line. */
    finish(symbol, finalText) {
      stop()
      console.log(`${symbol} ${finalText}`)
    },
  }
}

export const icon = {
  ok: chalk.green('✔'),
  fail: chalk.red('✖'),
  warn: chalk.yellow('⚠'),
  info: chalk.cyan('ℹ'),
  planned: chalk.yellow('○'),
}

const OUTPUT_TAIL_LINES = 25

export const info = (message) => console.log(`${icon.info} ${message}`)
export const warn = (message) => console.log(`${icon.warn} ${message}`)
export const note = (message) => console.log(chalk.dim(`  ${message}`))

export function heading(step, total, title) {
  console.log(`\n${chalk.bold.cyan(`[${step}/${total}]`)} ${chalk.bold(title)}`)
}

/** A step that would run, shown instead of running it in --dry-run. */
export function planned(title, command) {
  console.log(`${icon.planned} ${title} ${chalk.dim(`(dry run) ${command}`)}`)
}

/**
 * Runs fn behind a spinner. fn may return a string (shown dimmed after the title) or
 * { detail, warnings }. Never prompt or inherit stdio from inside fn: the spinner owns the TTY.
 */
export async function task(title, fn) {
  const spinner = createSpinner(title)
  try {
    const out = await fn({ setText: (text) => spinner.setText(`${title} ${chalk.dim(text)}`) })
    const { detail, warnings = [] } = typeof out === 'string' ? { detail: out } : (out ?? {})
    spinner.finish(icon.ok, detail ? `${title} ${chalk.dim(detail)}` : title)
    for (const w of warnings) warn(w)
  } catch (error) {
    spinner.finish(icon.fail, title)
    throw error
  }
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[i]}`
}

export function printError(error) {
  if (error instanceof ReleaseError) {
    console.error(`\n${icon.fail} ${chalk.red(error.message)}`)
    if (error.output?.trim()) {
      const lines = error.output.trim().split('\n')
      const shown = lines.slice(-OUTPUT_TAIL_LINES)
      if (lines.length > shown.length) console.error(chalk.dim(`  ... ${lines.length - shown.length} earlier lines hidden`))
      for (const line of shown) console.error(chalk.dim(`  ${line}`))
    }
    if (error.hint) console.error(`${chalk.cyan('→')} ${error.hint}`)
    return
  }
  console.error(`\n${icon.fail} ${chalk.red(`Unexpected error: ${error?.message ?? error}`)}`)
  if (process.env.RNMRS_DEBUG && error?.stack) console.error(chalk.dim(error.stack))
  else console.error(chalk.dim('  Re-run with RNMRS_DEBUG=1 for the stack trace.'))
}
