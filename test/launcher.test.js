import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { nativeBinaryPath } from '../src/lib/native.js'
import { cleanupTempDirs, tempDir, writeFile } from './helpers.js'

afterAll(cleanupTempDirs)

const root = fileURLToPath(new URL('..', import.meta.url))
const version = JSON.parse(readFileSync(`${root}package.json`, 'utf8')).version
const node = Bun.which('node')

async function run(command, args, { env = process.env, cwd = root } = {}) {
  const proc = Bun.spawn([command, ...args], { cwd, env, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  return { stdout: stdout.trim(), stderr: stderr.trim(), code }
}
const launcher = (args, env) => run(node, ['bin/rnmrs.js', ...args], { env })
const withEnv = (extra) => ({ ...process.env, ...extra })
// PATH with nothing on it: node is started by absolute path, but bun, deno and the rest cannot be found.
const emptyPath = () => ({ ...process.env, PATH: tempDir() })

// npm and Yarn start bins with Node, so the entry point is what chooses the runtime.
describe.skipIf(!node)('bin/rnmrs.js started with Node', () => {
  test('uses Bun first when it is installed', async () => {
    const result = await launcher(['--runtime'])
    expect(result.code).toBe(0)
    expect(result.stdout).toMatch(/^bun \d/)
  })

  test('runs on Node itself when Bun is not installed', async () => {
    const runtime = await launcher(['--runtime'], emptyPath())
    expect(runtime.code).toBe(0)
    expect(runtime.stdout).toMatch(/^node \d/)
    expect(await launcher(['--cli-version'], emptyPath())).toMatchObject({ stdout: version, code: 0 })
  })

  test('RNMRS_RUNTIME=node stays on Node even though Bun is installed', async () => {
    expect((await launcher(['--runtime'], withEnv({ RNMRS_RUNTIME: 'node' }))).stdout).toMatch(/^node \d/)
  })

  test('RNMRS_RUNTIME=bun hands over from Node to Bun', async () => {
    expect((await launcher(['--runtime'], withEnv({ RNMRS_RUNTIME: 'bun' }))).stdout).toMatch(/^bun \d/)
  })

  test('a process the launcher started never hands over again', async () => {
    expect((await launcher(['--runtime'], withEnv({ RNMRS_HANDED_OVER: '1' }))).stdout).toMatch(/^node \d/)
  })

  test('an unknown RNMRS_RUNTIME is refused', async () => {
    const result = await launcher(['--runtime'], withEnv({ RNMRS_RUNTIME: 'python' }))
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('bun, node or deno')
  })

  test('a requested runtime that is not installed is named', async () => {
    const result = await launcher(['--runtime'], { ...emptyPath(), RNMRS_RUNTIME: 'deno' })
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('could not find deno')
  })

  test('passes the exit code of a failing run through', async () => {
    expect((await launcher(['--type', 'not-a-type'])).code).not.toBe(0)
  })
})

describe.skipIf(!node)('the CLI itself on Node (no Bun anywhere)', () => {
  const onNode = (args, cwd) => run(node, [join(root, 'bin/rnmrs.js'), ...args], { cwd, env: { ...emptyPath(), RNMRS_RUNTIME: 'node' } })

  test('init, generate and listing work, with the prompts library and YAML on Node', async () => {
    const project = tempDir()
    writeFile(join(project, 'package.json'), JSON.stringify({ name: 'node-app' }))

    expect((await onNode(['--init', '--yes', '--with', 'revopush'], project)).code).toBe(0)
    const generated = await onNode(['--generate', '--yes'], project)
    expect(generated.code).toBe(0)
    expect(generated.stdout).toContain('Added 8 commands')

    const listed = await onNode(['--commands'], project)
    expect(listed.stdout).toContain('revo_android_development')
    // Apps are named after the project folder, which is a temp name here.
    expect(listed.stdout).toMatch(/RevoPush, .+-android \(android\), Development/)
  })

  test('errors are the same short messages, not stack traces', async () => {
    const project = tempDir()
    writeFile(join(project, 'package.json'), '{}')
    const result = await onNode(['revo_android_development'], project)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('No rnmrs.config.yml found')
    expect(result.stderr).not.toContain('at ')
  })
})

describe.skipIf(!node || !existsSync(nativeBinaryPath()))('the native helper bridge on Node', () => {
  test('process helpers and the Go core work through node:child_process', async () => {
    const script = `
      import('${join(root, 'src/lib/native.js')}').then(async (native) => {
        await native.assertCore()
        const tools = await native.preflight(process.cwd(), ['node', 'definitely-not-installed-xyz'])
        console.log(JSON.stringify({ node: tools.tools.node.found, missing: tools.tools['definitely-not-installed-xyz'].found }))
      })`
    const result = await run(node, ['-e', script])
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ node: true, missing: false })
  })
})
