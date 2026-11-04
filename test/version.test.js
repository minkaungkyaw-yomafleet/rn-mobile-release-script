import { describe, expect, test } from 'bun:test'
import { checkVersion } from '../src/prompts/version.js'

describe('checkVersion', () => {
  test('blank is allowed and means "use the native project version"', () => {
    expect(checkVersion('', 'revopush')).toEqual({ ok: true, value: '' })
    expect(checkVersion('   ', 'binary')).toEqual({ ok: true, value: '' })
    expect(checkVersion(undefined, 'binary')).toEqual({ ok: true, value: '' })
  })

  test('revopush accepts 2.0.0 and above', () => {
    for (const v of ['2.0.0', '2.0.1', '2.10.0', '10.0.0']) expect(checkVersion(v, 'revopush').ok).toBe(true)
  })

  test('revopush rejects anything below 2.0.0, including the 2.0.0 prerelease', () => {
    for (const v of ['1.9.9', '0.1.0', '2.0.0-beta.1']) {
      const result = checkVersion(v, 'revopush')
      expect(result.ok).toBe(false)
      expect(result.message).toContain('>= 2.0.0')
    }
  })

  test('binary has no minimum', () => {
    expect(checkVersion('1.5.3', 'binary')).toEqual({ ok: true, value: '1.5.3' })
  })

  test('normalizes a leading v', () => {
    expect(checkVersion('v2.1.0', 'revopush').value).toBe('2.1.0')
  })

  test('rejects values that are not exact x.y.z', () => {
    for (const v of ['2.1', 'abc', '2.x', '>=2.0.0']) expect(checkVersion(v, 'binary').ok).toBe(false)
  })
})
