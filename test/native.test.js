import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { assertCore, checkEnvFile, checkFastlaneEnv, cleanProject, nativeBinaryPath, preflight, readLanes } from '../src/lib/native.js'
import { cleanupTempDirs, tempDir, writeFile } from './helpers.js'

afterAll(cleanupTempDirs)

// Integration tests need the Go binary: `bun run build:native:current`.
const built = existsSync(nativeBinaryPath())
if (!built) console.warn('native.test.js skipped: run "bun run build:native:current" first')

describe.skipIf(!built)('Go core bridge', () => {
  test('protocol handshake', async () => {
    await assertCore()
  })

  test('preflight finds the running tool and reports a missing one', async () => {
    const res = await preflight(tempDir(), ['bun', 'definitely-not-installed-xyz'])
    expect(res.tools.bun.found).toBe(true)
    expect(res.tools.bun.version).toMatch(/\d/)
    expect(res.tools['definitely-not-installed-xyz'].found).toBe(false)
  })

  test('preflight rejects tool names that are paths', async () => {
    await expect(preflight(tempDir(), ['../../bin/sh'])).rejects.toThrow(/invalid tool name/)
  })

  test('env check reports names and counts, never values', async () => {
    const root = tempDir()
    writeFile(join(root, '.env.qa'), 'API_URL=https://qa.internal.example\nTOKEN=hunter2-not-a-real-secret\nBLANK=\n')
    const res = await checkEnvFile(root, '.env.qa')
    expect(res).toMatchObject({ exists: true, nonEmpty: true, keyCount: 3, emptyKeys: ['BLANK'] })
    const serialized = JSON.stringify(res)
    expect(serialized).not.toContain('hunter2')
    expect(serialized).not.toContain('internal.example')
  })

  test('env check: missing file, empty file, and a path that escapes the project', async () => {
    const root = tempDir()
    expect((await checkEnvFile(root, '.env.nope')).exists).toBe(false)
    writeFile(join(root, '.env.empty'), '')
    expect(await checkEnvFile(root, '.env.empty')).toMatchObject({ exists: true, nonEmpty: false })
    await expect(checkEnvFile(root, '../.env')).rejects.toThrow(/escapes/)
  })

  test('lane discovery follows imports and keeps platform and options', async () => {
    const dir = tempDir()
    writeFile(join(dir, 'fastlane/Fastfile'), 'default_platform(:ios)\nplatform :ios do\n  import "lanes/qa.rb"\nend\n')
    writeFile(join(dir, 'fastlane/lanes/qa.rb'), 'desc "Build QA"\nlane :build_qa do |options|\n  puts options[:version]\nend\n')
    const res = await readLanes(dir)
    expect(res.defaultPlatform).toBe('ios')
    expect(res.lanes).toMatchObject([{ name: 'build_qa', platform: 'ios', desc: 'Build QA', options: ['version'], private: false }])
  })

  test('fastlane credential check names the variables with missing files', async () => {
    const dir = tempDir()
    writeFile(join(dir, 'fastlane/.env'), 'PLAY_STORE_CREDENTIALS=./nope/play.json\nSENTRY_AUTH_TOKEN=\n')
    const res = await checkFastlaneEnv(dir)
    expect(res).toMatchObject({ envFile: true, missingPathVars: ['PLAY_STORE_CREDENTIALS'], emptyKeys: ['SENTRY_AUTH_TOKEN'] })
    expect(JSON.stringify(res)).not.toContain('play.json')
  })

  test('clean dry-run lists targets and deletes nothing', async () => {
    const root = tempDir()
    writeFile(join(root, 'package.json'), '{}')
    writeFile(join(root, 'android/app/build/out.bin'), '12345')
    const res = await cleanProject(root, 'android', { dryRun: true })
    expect(res.dryRun).toBe(true)
    expect(res.entries.find((e) => e.path.endsWith('android/app/build'))).toMatchObject({ status: 'would-remove', bytes: 5 })
    expect(existsSync(join(root, 'android/app/build/out.bin'))).toBe(true)
  })

  test('clean refuses a directory that is not a JS project', async () => {
    await expect(cleanProject(tempDir(), 'all', { dryRun: true })).rejects.toThrow(/no package.json/)
  })
})
