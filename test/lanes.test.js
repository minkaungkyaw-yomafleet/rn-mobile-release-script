import { describe, expect, test } from 'bun:test'
import { classifyLane, envAliases, groupLanes, laneCommand, resolveLanes } from '../src/fastlane/lanes.js'
import { pickLane } from '../src/fastlane/lanePolicy.js'
import { ReleaseError } from '../src/lib/errors.js'
import { BETTER_ANDROID, BETTER_IOS, PLUS_ANDROID, PLUS_IOS } from './helpers.js'

const resolve = (discovered, platform, env, extra = {}) => resolveLanes({ discovered, platform, env, interactive: false, ...extra })

describe('classifyLane', () => {
  const dev = envAliases('Development')
  test.each([
    ['build_dev', 'build'],
    ['distribute_dev', 'release'],
    ['build_and_distribute_dev', 'both'],
    ['ios_development_build', 'build'],
    ['ios_development_release', 'release'],
    ['dev', 'release'],
    ['set_version', null],
    ['android_development', null],
  ])('%s -> %p', (name, kind) => {
    expect(classifyLane(name, dev)).toBe(kind)
  })

  test('environment aliases', () => {
    expect(envAliases('Production')).toEqual(['production', 'prod'])
    expect(envAliases('prod')).toEqual(['production', 'prod'])
    expect(envAliases('Qa')).toEqual(['qa'])
    expect(envAliases('Sandbox')).toEqual(['sandbox'])
  })
})

describe('resolveLanes against the real lane names', () => {
  test('plus-mobile ios QA -> *_build then *_release', async () => {
    const out = await resolve(PLUS_IOS, 'ios', 'Qa')
    expect([out.build.name, out.release.name]).toEqual(['ios_qa_build', 'ios_qa_release'])
  })

  test('better-mobile ios QA prefers the build + distribute pair over the combined lane', async () => {
    const out = await resolve(BETTER_IOS, 'ios', 'Qa')
    expect([out.build.name, out.release.name]).toEqual(['build_qa', 'distribute_qa'])
    expect(out.single).toBeUndefined()
  })

  test('better-mobile android Development', async () => {
    const out = await resolve(BETTER_ANDROID, 'android', 'Development')
    expect([out.build.name, out.release.name]).toEqual(['build_dev', 'distribute_dev'])
  })

  test('plus-mobile android production is ambiguous and, without a tie-break, refuses to guess', async () => {
    await expect(resolve(PLUS_ANDROID, 'android', 'Production')).rejects.toThrow(/android_production_release, huawei_production_release/)
  })

  test('better-mobile ios production is ambiguous too (prod vs distribute_prod)', async () => {
    const error = await resolve(BETTER_IOS, 'ios', 'Production').catch((e) => e)
    expect(error).toBeInstanceOf(ReleaseError)
    expect(error.hint).toContain('fastlane.lanes.ios.production')
  })

  test('an interactive session is asked instead of failing', async () => {
    const asked = []
    const ask = async (question) => {
      asked.push(question.choices.map((c) => c.value))
      return 'android_production_release'
    }
    const out = await resolve(PLUS_ANDROID, 'android', 'Production', { interactive: true, ask })
    expect(asked).toEqual([['android_production_release', 'huawei_production_release']])
    expect([out.build.name, out.release.name]).toEqual(['android_production_build', 'android_production_release'])
  })

  test('pinned lanes in the config win and need no discovery', async () => {
    const out = await resolve([], 'android', 'Production', { configured: { build: 'b', release: 'r' } })
    expect([out.build.name, out.release.name]).toEqual(['b', 'r'])
  })

  test('auto_initialize_commands off and nothing pinned is an actionable error', async () => {
    await expect(resolve([], 'ios', 'Qa')).rejects.toThrow(/auto_initialize_commands is off/)
  })

  test('private lanes are never candidates', () => {
    const lanes = [{ name: 'build_dev', private: true, options: [] }, { name: 'build_dev_public', private: false, options: [] }]
    expect(groupLanes(lanes, 'Development').build.map((l) => l.name)).toEqual(['build_dev_public'])
  })

  test('a lane that builds and releases is used when there is no pair', async () => {
    const out = await resolve([{ name: 'build_and_distribute_qa', private: false, options: [] }], 'ios', 'Qa')
    expect(out.single.name).toBe('build_and_distribute_qa')
  })

  test('no match at all lists what exists', async () => {
    await expect(resolve(PLUS_IOS, 'ios', 'Sandbox')).rejects.toThrow(/No Fastlane lane matches ios\/Sandbox/)
  })
})

describe('pickLane default policy', () => {
  test('never guesses until the team supplies a rule', () => {
    expect(pickLane([{ name: 'a', tokens: ['a'] }, { name: 'b', tokens: ['b'] }], { platform: 'ios', env: 'Qa', kind: 'release' })).toBeNull()
  })
})

describe('laneCommand', () => {
  const lane = { name: 'build_qa', platform: 'ios', options: ['clean', 'version'] }

  test('uses bundler when the project has a Gemfile', () => {
    expect(laneCommand({ lane, defaultPlatform: 'ios', version: '', bundler: true })).toEqual({ cmd: 'bundle', args: ['exec', 'fastlane', 'build_qa'] })
    expect(laneCommand({ lane, defaultPlatform: 'ios', version: '', bundler: false })).toEqual({ cmd: 'fastlane', args: ['build_qa'] })
  })

  test('spells out the platform only when it is not the default', () => {
    expect(laneCommand({ lane, defaultPlatform: 'android', version: '', bundler: false }).args).toEqual(['ios', 'build_qa'])
  })

  test('passes the version only to lanes that read options[:version]', () => {
    expect(laneCommand({ lane, defaultPlatform: 'ios', version: '2.1.0', bundler: false }).args).toEqual(['build_qa', 'version:2.1.0'])
    const noVersion = { ...lane, options: ['clean'] }
    expect(laneCommand({ lane: noVersion, defaultPlatform: 'ios', version: '2.1.0', bundler: false }).args).toEqual(['build_qa'])
  })
})
