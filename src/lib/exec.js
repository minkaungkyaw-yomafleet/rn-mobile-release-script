// Every process is started from an argv array, never through a shell, so user input
// (description text, app names) cannot be interpreted as shell syntax.

/** Run to completion with output captured. Never throws; a missing binary yields code 127. */
export async function capture(cmd, args, { cwd, env } = {}) {
  try {
    const proc = Bun.spawn([cmd, ...args], {
      cwd,
      env: { ...process.env, ...env },
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return { code, stdout, stderr }
  } catch (error) {
    return { code: 127, stdout: '', stderr: error.message }
  }
}

/** Run with the terminal attached, so tools can show progress and ask their own questions. */
export async function inherit(cmd, args, { cwd, env } = {}) {
  try {
    const proc = Bun.spawn([cmd, ...args], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['inherit', 'inherit', 'inherit'],
    })
    return await proc.exited
  } catch (error) {
    console.error(error.message)
    return 127
  }
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
