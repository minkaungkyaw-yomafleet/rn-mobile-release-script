import { afterAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import YAML from 'yaml'
import { runInit } from '../src/config/init.js'
import { findConfigFile } from '../src/config/load.js'
import { envFileFor, normalizeConfig } from '../src/config/schema.js'
import { ReleaseError } from '../src/lib/errors.js'
import { cleanupTempDirs, sampleConfig, tempDir, writeFile } from './helpers.js'

afterAll(cleanupTempDirs)

// The sample from the original brief, verbatim: no production env file.
const BRIEF_SAMPLE = `
project_name: MyAwesomeApp
env_files:
  - path: .env.development
    target: development
  - path: .env.qa
    target: qa
  - path: .env.staging
    target: staging
revopush:
  applications:
    - name: plus-mobile-android
      target: android
    - name: plus-mobile-ios
      target: ios
  environments:
    - Development
    - Production
    - Qa
    - Staging
fastlane:
  ios:
    path: "./ios"
  android:
    path: "./android"
  auto_initialize_commands: true
`

const problemsOf = (raw) => {
  try {
    normalizeConfig(raw)
  } catch (error) {
    expect(error).toBeInstanceOf(ReleaseError)
    return error.output
  }
  throw new Error('expected normalizeConfig to throw')
}

describe('normalizeConfig', () => {
  test('accepts the sample from the brief', () => {
    const config = normalizeConfig(YAML.parse(BRIEF_SAMPLE))
    expect(config.environments).toEqual(['Development', 'Production', 'Qa', 'Staging'])
    expect(config.fastlane.autoInitialize).toBe(true)
    expect(config.revopush.applications.map((a) => a.name)).toEqual(['plus-mobile-android', 'plus-mobile-ios'])
  })

  test('the brief sample has no env file for Production, which the pre-check must catch', () => {
    const config = normalizeConfig(YAML.parse(BRIEF_SAMPLE))
    expect(envFileFor(config, 'Production')).toBeUndefined()
    expect(envFileFor(config, 'qa').path).toBe('.env.qa')
  })

  test('defaults: fastlane paths, auto_initialize_commands, environments from env_files', () => {
    const config = normalizeConfig({ project_name: 'x', env_files: [{ path: '.env.qa', target: 'QA' }] })
    expect(config.fastlane.ios.path).toBe('./ios')
    expect(config.fastlane.autoInitialize).toBe(true)
    expect(config.revopush).toBeNull()
    expect(config.environments).toEqual(['Qa'])
  })

  test('reports every problem at once', () => {
    const out = problemsOf({
      env_files: [{ path: '/etc/passwd', target: 'qa' }, { path: '../outside', target: 'qa' }, { target: 'x' }],
      revopush: { applications: [{ name: 'a', target: 'windows' }] },
      fastlane: { auto_initialize_commands: 'yes' },
    })
    for (const expected of ['project_name is required', 'must stay inside the project: /etc/passwd', 'must stay inside the project: ../outside', 'env_files[2].path is required', 'must be one of android, ios', 'auto_initialize_commands must be true or false']) {
      expect(out).toContain(expected)
    }
  })

  test('rejects duplicate targets, duplicate apps and duplicate environments', () => {
    const out = problemsOf({
      project_name: 'x',
      env_files: [{ path: '.env.a', target: 'qa' }, { path: '.env.b', target: 'QA' }],
      revopush: {
        applications: [{ name: 'a', target: 'ios' }, { name: 'a', target: 'android' }],
        environments: ['Qa', 'qa'],
      },
    })
    expect(out).toContain('two entries for target "qa"')
    expect(out).toContain('two entries named "a"')
    expect(out).toContain('lists "qa" twice')
  })

  test('validates pinned lanes', () => {
    const base = { project_name: 'x', env_files: [{ path: '.env.qa', target: 'qa' }] }
    const config = normalizeConfig({ ...base, fastlane: { lanes: { android: { Production: { build: 'b', release: 'r' } } } } })
    expect(config.fastlane.lanes.android.production).toEqual({ build: 'b', release: 'r' })
    expect(problemsOf({ ...base, fastlane: { lanes: { android: { qa: { build: 'rm -rf /' } } } } })).toContain('must be a lane name')
    expect(problemsOf({ ...base, fastlane: { lanes: { web: {} } } })).toContain('platform must be one of')
  })

  test('rejects a non-mapping document with a hint', () => {
    expect(() => normalizeConfig(null)).toThrow(ReleaseError)
    expect(() => normalizeConfig('just a string')).toThrow(ReleaseError)
  })
})

describe('findConfigFile', () => {
  test('finds the config from a nested folder', () => {
    const root = tempDir()
    writeFile(join(root, 'rnmrs.config.yml'), 'x: 1')
    writeFile(join(root, 'ios/Pods/.keep'))
    expect(findConfigFile(join(root, 'ios/Pods'))).toBe(join(root, 'rnmrs.config.yml'))
  })

  test('returns null when there is none', () => {
    expect(findConfigFile(tempDir())).toBeNull()
  })
})

describe('runInit', () => {
  test('creates a valid config named after the repo', async () => {
    const root = join(tempDir(), 'better-mobile')
    writeFile(join(root, 'package.json'), JSON.stringify({ name: 'Better' }))
    await runInit({ cwd: root, yes: true })

    const text = readFileSync(join(root, 'rnmrs.config.yml'), 'utf8')
    const config = normalizeConfig(YAML.parse(text))
    expect(config.projectName).toBe('Better')
    expect(config.revopush.applications.map((a) => a.name)).toEqual(['better-mobile-android', 'better-mobile-ios'])
    expect(envFileFor(config, 'Production')).toBeDefined()
  })

  test('--yes never overwrites an existing config', async () => {
    const root = tempDir()
    writeFile(join(root, 'package.json'), '{}')
    writeFile(join(root, 'rnmrs.config.yml'), 'keep: me\n')
    await runInit({ cwd: root, yes: true })
    expect(readFileSync(join(root, 'rnmrs.config.yml'), 'utf8')).toBe('keep: me\n')
  })

  test('refuses outside a JS project', async () => {
    await expect(runInit({ cwd: tempDir(), yes: true })).rejects.toBeInstanceOf(ReleaseError)
  })

  test('a project name with YAML-special characters stays valid YAML', async () => {
    const root = join(tempDir(), 'app')
    writeFile(join(root, 'package.json'), JSON.stringify({ name: 'My: App #1' }))
    await runInit({ cwd: root, yes: true })
    const config = normalizeConfig(YAML.parse(readFileSync(join(root, 'rnmrs.config.yml'), 'utf8')))
    expect(config.projectName).toBe('My: App #1')
  })

  test('sampleConfig helper stays in sync with the template', () => {
    expect(sampleConfig().environments).toContain('Production')
  })
})
