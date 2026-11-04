import { describe, expect, test } from 'bun:test'
import { revopushArgs } from '../src/pipeline/revopush.js'
import { collectAnswers } from '../src/prompts/index.js'
import { sampleConfig } from './helpers.js'

const config = sampleConfig()
const ask = (flags) => collectAnswers(config, flags, { interactive: false })

describe('collectAnswers (flags only, as in CI)', () => {
  test('the example from the brief', async () => {
    const answers = await ask({ type: 'revopush', app: 'plus-mobile-android', env: 'Development', description: 'Hotfix for master branch' })
    expect(answers).toMatchObject({ type: 'revopush', platform: 'android', environment: 'Development', version: '', description: 'Hotfix for master branch' })
    expect(answers.app.name).toBe('plus-mobile-android')
  })

  test('the application decides the platform', async () => {
    expect((await ask({ type: 'revopush', app: 'plus-mobile-ios', env: 'Qa' })).platform).toBe('ios')
  })

  test('environment matching ignores case but keeps the configured spelling RevoPush needs', async () => {
    expect((await ask({ type: 'binary', platform: 'ios', env: 'qa' })).environment).toBe('Qa')
  })

  test('binary needs a platform from -p or -a', async () => {
    await expect(ask({ type: 'binary', env: 'Qa' })).rejects.toThrow(/platform is required/)
    expect((await ask({ type: 'binary', app: 'plus-mobile-ios', env: 'Qa' })).platform).toBe('ios')
  })

  test('single application per platform is chosen without -a', async () => {
    const answers = await ask({ type: 'revopush', platform: 'android', env: 'Staging' })
    expect(answers.app.name).toBe('plus-mobile-android')
  })

  test('unknown application and environment list what is valid', async () => {
    await expect(ask({ type: 'revopush', app: 'nope', env: 'Qa' })).rejects.toThrow(/Unknown application "nope"/)
    const error = await ask({ type: 'binary', platform: 'ios', env: 'Nope' }).catch((e) => e)
    expect(error.hint).toContain('Development, Production, Qa, Staging')
  })

  test('--platform conflicting with the application is rejected', async () => {
    await expect(ask({ type: 'revopush', app: 'plus-mobile-ios', platform: 'android', env: 'Qa' })).rejects.toThrow(/conflicts/)
  })

  test('revopush versions below 2.0.0 are rejected, valid ones normalized', async () => {
    await expect(ask({ type: 'revopush', app: 'plus-mobile-ios', env: 'Qa', version: '1.9.0' })).rejects.toThrow(/>= 2.0.0/)
    expect((await ask({ type: 'revopush', app: 'plus-mobile-ios', env: 'Qa', version: 'v2.3.0' })).version).toBe('2.3.0')
    expect((await ask({ type: 'binary', platform: 'ios', env: 'Qa', version: '1.0.0' })).version).toBe('1.0.0')
  })

  test('missing required choices fail with the flag to pass instead of hanging on a prompt', async () => {
    await expect(ask({})).rejects.toThrow(/release type is required/)
    await expect(ask({ type: 'binary', platform: 'ios' })).rejects.toThrow(/environment is required/)
  })

  test('revopush without a revopush section is explained', async () => {
    const noRevopush = { ...config, revopush: null }
    await expect(collectAnswers(noRevopush, { type: 'revopush', platform: 'ios', env: 'Qa' }, { interactive: false })).rejects.toThrow(/no revopush section/)
  })
})

describe('revopushArgs', () => {
  const app = { name: 'plus-mobile-android' }

  test('matches the command in the brief', () => {
    expect(revopushArgs({ app, platform: 'android', environment: 'Development', version: '2.1.0', description: 'Hotfix for master branch' })).toEqual([
      'release-react', 'plus-mobile-android', 'android', '-d', 'Development', '-t', '2.1.0', '--des', 'Hotfix for master branch',
    ])
  })

  test('omits blank version and description so RevoPush uses its own defaults', () => {
    expect(revopushArgs({ app, platform: 'android', environment: 'Qa', version: '', description: '' })).toEqual(['release-react', 'plus-mobile-android', 'android', '-d', 'Qa'])
  })

  test('shell metacharacters in the description stay one inert argument', () => {
    const description = `fix"; rm -rf ~ #$(whoami) 'x'`
    const args = revopushArgs({ app, platform: 'android', environment: 'Qa', version: '', description })
    expect(args.at(-1)).toBe(description)
    expect(args.filter((a) => a === '--des')).toHaveLength(1)
  })
})
