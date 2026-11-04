import { afterAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { cleanupTempDirs, tempDir } from './helpers.js'

afterAll(cleanupTempDirs)

const root = fileURLToPath(new URL('..', import.meta.url))
const version = JSON.parse(readFileSync(`${root}package.json`, 'utf8')).version
const node = Bun.which('node')

async function runLauncher(args, env) {
  const proc = Bun.spawn([node, 'bin/rnmrs.js', ...args], { cwd: root, env, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  return { stdout: stdout.trim(), stderr: stderr.trim(), code }
}

// npm and Yarn start bins with Node, so the entry point must work from Node as well as Bun.
describe.skipIf(!node)('bin/rnmrs.js started with Node', () => {
  test('hands over to Bun and runs the CLI', async () => {
    const result = await runLauncher(['--cli-version'], process.env)
    expect(result).toMatchObject({ stdout: version, code: 0 })
  })

  test('passes the exit code of a failing run through', async () => {
    const result = await runLauncher(['--type', 'not-a-type'], process.env)
    expect(result.code).not.toBe(0)
  })

  test('explains how to get Bun when it is not installed', async () => {
    // An empty PATH: node itself is started by absolute path, but `bun` cannot be found.
    const result = await runLauncher(['--cli-version'], { PATH: tempDir() })
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('needs Bun')
    expect(result.stderr).toContain('https://bun.sh')
  })
})
