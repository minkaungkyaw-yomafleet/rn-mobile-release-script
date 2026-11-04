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

  test('any valid release version is accepted for revopush and binary, and normalized', async () => {
    expect((await ask({ type: 'revopush', app: 'plus-mobile-ios', env: 'Qa', version: '0.1.0' })).version).toBe('0.1.0')
    expect((await ask({ type: 'revopush', app: 'plus-mobile-ios', env: 'Qa', version: 'v2.3.0' })).version).toBe('2.3.0')
    expect((await ask({ type: 'binary', platform: 'ios', env: 'Qa', version: '1.0.0' })).version).toBe('1.0.0')
  })

  test('a version that is not x.y.z is rejected with a clear message', async () => {
    await expect(ask({ type: 'revopush', app: 'plus-mobile-ios', env: 'Qa', version: '2.1' })).rejects.toThrow(/not a valid version/)
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

describe('collectAnswers when only one tool is configured', () => {
  const revopushOnly = { ...config, fastlane: { ...config.fastlane, enabled: false } }
  const fastlaneOnly = { ...config, revopush: null }
  const run = (cfg, flags) => collectAnswers(cfg, flags, { interactive: false })

  test('the only configured type is used without -t', async () => {
    expect((await run(revopushOnly, { app: 'plus-mobile-android', env: 'Qa' })).type).toBe('revopush')
    expect((await run(fastlaneOnly, { platform: 'ios', env: 'Qa' })).type).toBe('binary')
  })

  test('asking for the type that is not configured explains how to add it, and offers the other one', async () => {
    const binary = await run(revopushOnly, { type: 'binary', platform: 'ios', env: 'Qa' }).catch((e) => e)
    expect(binary.message).toContain('no fastlane section')
    expect(binary.hint).toContain('-t revopush')

    const revopush = await run(fastlaneOnly, { type: 'revopush', platform: 'ios', env: 'Qa' }).catch((e) => e)
    expect(revopush.message).toContain('no revopush section')
    expect(revopush.hint).toContain('-t binary')
  })

  test('with both configured, the type is still required in a non-interactive session', async () => {
    await expect(run(config, { platform: 'ios', env: 'Qa' })).rejects.toThrow(/release type is required/)
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

  test('passes the Xcode target to RevoPush only when it must resolve the version', () => {
    const args = revopushArgs({ app, platform: 'ios', environment: 'Qa', version: '', xcodeTarget: 'AppQa', description: '' })
    expect(args).toEqual(['release-react', 'plus-mobile-android', 'ios', '-d', 'Qa', '--xt', 'AppQa'])
    expect(revopushArgs({ app, platform: 'ios', environment: 'Qa', version: '1.5.3', description: '' })).not.toContain('--xt')
  })

  test('shell metacharacters in the description stay one inert argument', () => {
    const description = `fix"; rm -rf ~ #$(whoami) 'x'`
    const args = revopushArgs({ app, platform: 'android', environment: 'Qa', version: '', description })
    expect(args.at(-1)).toBe(description)
    expect(args.filter((a) => a === '--des')).toHaveLength(1)
  })
})
