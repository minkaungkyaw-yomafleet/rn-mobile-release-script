import { afterAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { ReleaseError } from '../src/lib/errors.js'
import { formatCommand } from '../src/lib/exec.js'
import { detectPackageManager, fallbackPackageManager, installCommand, majorOf } from '../src/lib/pm.js'
import { cleanupTempDirs, tempDir, writeFile } from './helpers.js'

afterAll(cleanupTempDirs)

const project = (files) => {
  const root = tempDir()
  for (const [name, content] of Object.entries(files)) writeFile(join(root, name), content)
  return root
}

describe('detectPackageManager', () => {
  test('from the lockfile', () => {
    expect(detectPackageManager(project({ 'package.json': '{}', 'bun.lock': '' })).name).toBe('bun')
    expect(detectPackageManager(project({ 'package.json': '{}', 'yarn.lock': '' })).name).toBe('yarn')
    expect(detectPackageManager(project({ 'package.json': '{}', 'package-lock.json': '{}' })).name).toBe('npm')
  })

  test('the packageManager field outranks a stray lockfile (plus-mobile: yarn@3.6.4)', () => {
    const root = project({ 'package.json': JSON.stringify({ packageManager: 'yarn@3.6.4' }), 'bun.lock': '' })
    expect(detectPackageManager(root).name).toBe('yarn')
  })

  test('no signal returns null so the caller can fall back', () => {
    expect(detectPackageManager(project({ 'package.json': '{}' })).name).toBeNull()
  })

  test('pnpm is not supported and says so', () => {
    const root = project({ 'package.json': JSON.stringify({ packageManager: 'pnpm@9.0.0' }) })
    expect(() => detectPackageManager(root)).toThrow(ReleaseError)
  })

  test('fallback prefers bun, then yarn, then npm, among what is installed', () => {
    expect(fallbackPackageManager({ yarn: { found: true }, npm: { found: true } })).toBe('yarn')
    expect(fallbackPackageManager({ bun: { found: false } })).toBeNull()
  })
})

describe('installCommand', () => {
  test('always reproducible, never rewriting the lockfile', () => {
    expect(installCommand('bun', null)).toEqual(['bun', 'install', '--frozen-lockfile'])
    expect(installCommand('npm', null)).toEqual(['npm', 'ci'])
    expect(installCommand('yarn', 3)).toEqual(['yarn', 'install', '--immutable'])
    expect(installCommand('yarn', 1)).toEqual(['yarn', 'install', '--frozen-lockfile'])
  })

  test('majorOf reads the first number', () => {
    expect(majorOf('3.6.4')).toBe(3)
    expect(majorOf('1.22.22')).toBe(1)
    expect(majorOf(undefined)).toBeNull()
  })
})

describe('formatCommand', () => {
  test('quotes only what needs quoting', () => {
    expect(formatCommand('revopush', ['release-react', 'app', '-d', 'Qa'])).toBe('revopush release-react app -d Qa')
    expect(formatCommand('revopush', ['--des', "it's a fix"])).toBe(`revopush --des 'it'\\''s a fix'`)
  })
})
