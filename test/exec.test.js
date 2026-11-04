import { describe, expect, test } from 'bun:test'
import { capture, formatCommand, inherit } from '../src/lib/exec.js'
import { currentRuntime } from '../src/lib/runtime.js'

// process.execPath is whichever runtime runs these tests; the helpers only need "a program".
const program = process.execPath

describe('capture', () => {
  test('returns stdout, stderr and the exit code', async () => {
    const result = await capture(program, ['-e', "console.log('out'); console.error('err'); process.exit(3)"])
    expect(result).toEqual({ code: 3, stdout: 'out\n', stderr: 'err\n' })
  })

  test('a missing program is code 127 with a message, never a throw', async () => {
    const result = await capture('definitely-not-installed-xyz', [])
    expect(result.code).toBe(127)
    expect(result.stderr).toContain('definitely-not-installed-xyz')
  })

  test('the child gets no stdin, so a tool that asks a question fails instead of hanging', async () => {
    const result = await capture(program, ['-e', "process.stdin.on('end', () => console.log('eof')); process.stdin.resume()"])
    expect(result.stdout.trim()).toBe('eof')
  })

  test('arguments are passed as is, never through a shell', async () => {
    const hostile = `fix"; echo pwned #$(whoami) 'x'`
    const result = await capture(program, ['-e', 'console.log(process.argv[1])', hostile])
    expect(result.stdout.trim()).toBe(hostile)
  })

  test('extra environment is added to the current one', async () => {
    const result = await capture(program, ['-e', 'console.log(process.env.RNMRS_TEST_VALUE + "|" + Boolean(process.env.PATH))'], { env: { RNMRS_TEST_VALUE: 'yes' } })
    expect(result.stdout.trim()).toBe('yes|true')
  })

  test('runs in the given folder', async () => {
    const result = await capture(program, ['-e', 'console.log(process.cwd())'], { cwd: '/' })
    expect(result.stdout.trim()).toBe('/')
  })
})

describe('inherit', () => {
  test('returns the exit code of the program', async () => {
    expect(await inherit(program, ['-e', 'process.exit(0)'])).toBe(0)
    expect(await inherit(program, ['-e', 'process.exit(4)'])).toBe(4)
  })

  test('a missing program is code 127', async () => {
    const original = console.error
    console.error = () => {}
    try {
      expect(await inherit('definitely-not-installed-xyz', [])).toBe(127)
    } finally {
      console.error = original
    }
  })
})

describe('formatCommand', () => {
  test('quotes only what needs it', () => {
    expect(formatCommand('revopush', ['release-react', 'app', '-d', 'Qa'])).toBe('revopush release-react app -d Qa')
    expect(formatCommand('revopush', ['--des', "it's a fix"])).toBe(`revopush --des 'it'\\''s a fix'`)
  })
})

describe('currentRuntime', () => {
  test('names the runtime and its version', () => {
    const runtime = currentRuntime()
    expect(['bun', 'node', 'deno']).toContain(runtime.name)
    expect(runtime.version).toMatch(/^\d+\./)
  })

  test('this suite runs on Bun', () => {
    expect(currentRuntime().name).toBe('bun')
  })
})
