import { spawn } from 'node:child_process'

// Every process is started from an argv array, never through a shell, so user input
// (description text, app names) cannot be interpreted as shell syntax. node:child_process is
// used so the same code runs on Node, Bun and Deno.

/** Exit code for a process that ended without one: shells report a Ctrl+C as 130. */
const exitCode = (code, signal) => code ?? (signal === 'SIGINT' ? 130 : 1)

/** Run to completion with output captured. Never throws; a missing binary yields code 127. */
export function capture(cmd, args, { cwd, env } = {}) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      resolve({ code: 127, stdout: '', stderr: error.message })
      return
    }
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk))
    child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk))
    child.on('error', (error) => resolve({ code: 127, stdout, stderr: error.message }))
    child.on('close', (code, signal) => resolve({ code: exitCode(code, signal), stdout, stderr }))
  })
}

/** Run with the terminal attached, so tools can show progress and ask their own questions. */
export function inherit(cmd, args, { cwd, env } = {}) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: 'inherit' })
    } catch (error) {
      console.error(error.message)
      resolve(127)
      return
    }
    child.on('error', (error) => {
      console.error(error.message)
      resolve(127)
    })
    child.on('close', (code, signal) => resolve(exitCode(code, signal)))
  })
}

/**
 * CocoaPods and Fastlane both warn or fail without a UTF-8 locale. Only fills the gap;
 * a developer whose locale is already UTF-8 (any language) keeps it.
 */
export function utf8Env() {
  const locale = process.env.LC_ALL || process.env.LANG || ''
  return /utf-?8/i.test(locale) ? {} : { LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' }
}

/** Display form of a command, quoting only the arguments that need it. */
export function formatCommand(cmd, args = []) {
  const quote = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replaceAll("'", `'\\''`)}'`)
  return [cmd, ...args].map(quote).join(' ')
}
