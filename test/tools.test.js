import { afterAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { detectTools, parseToolList } from '../src/config/tools.js'
import { ReleaseError } from '../src/lib/errors.js'
import { cleanupTempDirs, tempDir, writeFile } from './helpers.js'

afterAll(cleanupTempDirs)

const project = (files) => {
  const root = tempDir()
  for (const [name, content] of Object.entries(files)) writeFile(join(root, name), content)
  return root
}

describe('detectTools', () => {
  test('finds Fastlane from a Fastfile in either platform folder or the root', () => {
    for (const file of ['ios/fastlane/Fastfile', 'android/fastlane/Fastfile', 'fastlane/Fastfile']) {
      expect(detectTools(project({ 'package.json': '{}', [file]: '' }))).toEqual({ fastlane: true, revopush: false })
    }
  })

  test('finds RevoPush from a @revopush dependency or a script that calls it', () => {
    const dep = project({ 'package.json': JSON.stringify({ dependencies: { '@revopush/react-native-code-push': '^1' } }) })
    const script = project({ 'package.json': JSON.stringify({ scripts: { 'ios:devRevoPush': 'revopush release-react app ios' } }) })
    expect(detectTools(dep).revopush).toBe(true)
    expect(detectTools(script).revopush).toBe(true)
  })

  test('finds nothing in a plain project, and survives an unreadable package.json', () => {
    expect(detectTools(project({ 'package.json': '{}' }))).toEqual({ fastlane: false, revopush: false })
    expect(detectTools(project({ 'package.json': '{not json' }))).toEqual({ fastlane: false, revopush: false })
  })
})

describe('parseToolList', () => {
  test('accepts one or both tools, in any case, with spaces', () => {
    expect(parseToolList('revopush')).toEqual(['revopush'])
    expect(parseToolList(' Fastlane , REVOPUSH ')).toEqual(['fastlane', 'revopush'])
  })

  test('drops duplicates and keeps the order given', () => {
    expect(parseToolList('revopush,fastlane,revopush')).toEqual(['revopush', 'fastlane'])
  })

  test('rejects unknown tools and empty lists with a hint', () => {
    for (const bad of ['codepush', 'fastlane,xcode', '', ' , ']) {
      const error = (() => {
        try {
          parseToolList(bad)
        } catch (e) {
          return e
        }
      })()
      expect(error).toBeInstanceOf(ReleaseError)
      expect(error.hint).toContain('fastlane, revopush')
    }
  })
})
