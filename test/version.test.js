import { describe, expect, test } from 'bun:test'
import { checkVersion, versionValidator } from '../src/prompts/version.js'

describe('checkVersion', () => {
  test('blank is allowed and means "use the native project version"', () => {
    expect(checkVersion('')).toEqual({ ok: true, value: '' })
    expect(checkVersion('   ')).toEqual({ ok: true, value: '' })
    expect(checkVersion(undefined)).toEqual({ ok: true, value: '' })
  })

  test('there is no minimum: 0.1.0 and 2.4.0 are equally valid', () => {
    for (const v of ['0.0.1', '0.1.0', '1.5.3', '2.0.0', '2.4.0', '10.0.0']) {
      expect(checkVersion(v)).toEqual({ ok: true, value: v })
    }
  })

  test('prereleases are valid versions too', () => {
    expect(checkVersion('0.2.0-beta.1')).toEqual({ ok: true, value: '0.2.0-beta.1' })
  })

  test('normalizes a leading v', () => {
    expect(checkVersion('v0.1.0').value).toBe('0.1.0')
  })

  test('rejects values that are not exact x.y.z', () => {
    for (const v of ['2.1', 'abc', '2.x', '>=2.0.0', '~0.1.0']) expect(checkVersion(v).ok).toBe(false)
  })

  test('the error shows an example and names the bad value', () => {
    const result = checkVersion('1.2')
    expect(result.message).toContain('"1.2"')
    expect(result.message).toContain('0.1.0')
  })
})

describe('versionValidator (the prompt adapter)', () => {
  test('returns true when valid and the message when not', () => {
    expect(versionValidator('0.1.0')).toBe(true)
    expect(versionValidator('')).toBe(true)
    expect(versionValidator('nope')).toContain('not a valid version')
  })
})
