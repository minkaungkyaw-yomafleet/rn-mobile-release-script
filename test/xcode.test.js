import { afterAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { ReleaseError } from '../src/lib/errors.js'
import { parseXcodeTargets, readXcodeTargets, resolveIosVersion, targetVersion } from '../src/lib/xcode.js'
import { cleanupTempDirs, tempDir, writeFile } from './helpers.js'

afterAll(cleanupTempDirs)

// A project.pbxproj reduced to what matters, in Xcode's real layout (tabs, comment markers). It
// mirrors a real app: app targets at 1.5.3 and notification extensions left at 1.0.0.
const id = (n) => n.toString(16).toUpperCase().padStart(24, '0')
function config(n, name, version) {
  const line = version === undefined ? '' : `\t\t\t\tMARKETING_VERSION = ${version};\n`
  return `\t\t${id(n)} /* ${name} */ = {\n\t\t\tisa = XCBuildConfiguration;\n\t\t\tbuildSettings = {\n${line}\t\t\t\tPRODUCT_NAME = x;\n\t\t\t};\n\t\t\tname = ${name};\n\t\t};\n`
}
function list(n, target, debugId, releaseId) {
  return `\t\t${id(n)} /* Build configuration list for PBXNativeTarget "${target}" */ = {\n\t\t\tisa = XCConfigurationList;\n\t\t\tbuildConfigurations = (\n\t\t\t\t${id(debugId)} /* Debug */,\n\t\t\t\t${id(releaseId)} /* Release */,\n\t\t\t);\n\t\t\tdefaultConfigurationName = Release;\n\t\t};\n`
}
const PBXPROJ = [
  '/* Begin XCBuildConfiguration section */\n',
  config(1, 'Debug', '1.5.3'), config(2, 'Release', '1.5.3'), // PLUS
  config(3, 'Debug', '1.5.3'), config(4, 'Release', '1.5.3'), // PLUSDevelopment
  config(5, 'Debug', '1.0.0'), config(6, 'Release', '1.0.0'), // PLUSNotificationService
  config(7, 'Debug', '$(APP_VERSION)'), config(8, 'Release', '$(APP_VERSION)'), // PLUSWidget (a variable)
  config(9, 'Debug'), config(10, 'Release'), // the project itself: no MARKETING_VERSION
  '/* End XCBuildConfiguration section */\n/* Begin XCConfigurationList section */\n',
  list(101, 'PLUS', 1, 2), list(102, 'PLUSDevelopment', 3, 4), list(103, 'PLUSNotificationService', 5, 6), list(104, 'PLUSWidget', 7, 8),
  `\t\t${id(105)} /* Build configuration list for PBXProject "PLUS" */ = {\n\t\t\tisa = XCConfigurationList;\n\t\t\tbuildConfigurations = (\n\t\t\t\t${id(9)} /* Debug */,\n\t\t\t\t${id(10)} /* Release */,\n\t\t\t);\n\t\t};\n`,
  '/* End XCConfigurationList section */\n',
].join('')

const targets = parseXcodeTargets(PBXPROJ)
const byName = (name) => targets.find((t) => t.name === name)

describe('parseXcodeTargets', () => {
  test('finds every native target with its version per configuration, and skips the project entry', () => {
    expect(targets.map((t) => t.name)).toEqual(['PLUS', 'PLUSDevelopment', 'PLUSNotificationService', 'PLUSWidget'])
    expect(byName('PLUS').versions).toEqual({ Debug: '1.5.3', Release: '1.5.3' })
    expect(byName('PLUSNotificationService').versions).toEqual({ Debug: '1.0.0', Release: '1.0.0' })
  })

  test('handles a quoted version', () => {
    const quoted = PBXPROJ.replace('MARKETING_VERSION = 1.5.3;', 'MARKETING_VERSION = "1.5.3";')
    expect(parseXcodeTargets(quoted).find((t) => t.name === 'PLUS').versions.Debug).toBe('1.5.3')
  })

  test('returns nothing for text that is not a project', () => {
    expect(parseXcodeTargets('hello')).toEqual([])
  })
})

describe('targetVersion', () => {
  test('uses the Release version, and ignores variables it cannot resolve', () => {
    expect(targetVersion(byName('PLUS'))).toBe('1.5.3')
    expect(targetVersion(byName('PLUSWidget'))).toBeNull()
  })
})

describe('resolveIosVersion', () => {
  test('a configured target gives its real version, not another target\'s', () => {
    expect(resolveIosVersion({ targets, xcodeTarget: 'PLUSDevelopment' })).toEqual({ version: '1.5.3', via: 'Xcode target PLUSDevelopment' })
  })

  test('a configured target whose version is a variable is handed to RevoPush by name', () => {
    expect(resolveIosVersion({ targets, xcodeTarget: 'PLUSWidget' })).toEqual({ xcodeTarget: 'PLUSWidget', via: 'Xcode target PLUSWidget' })
  })

  test('an unknown target is an error that lists the real ones', () => {
    const error = (() => {
      try {
        resolveIosVersion({ targets, xcodeTarget: 'Nope' })
      } catch (e) {
        return e
      }
    })()
    expect(error).toBeInstanceOf(ReleaseError)
    expect(error.hint).toContain('PLUS, PLUSDevelopment')
  })

  test('targets that disagree with nothing configured stop the release instead of guessing', () => {
    const error = (() => {
      try {
        resolveIosVersion({ targets, xcodeTarget: '' })
      } catch (e) {
        return e
      }
    })()
    expect(error).toBeInstanceOf(ReleaseError)
    expect(error.output).toContain('PLUS: 1.5.3')
    expect(error.output).toContain('PLUSNotificationService: 1.0.0')
    expect(error.hint).toContain('xcode_targets')
  })

  test('targets that all agree need no help', () => {
    const agreeing = targets.filter((t) => t.name !== 'PLUSNotificationService')
    expect(resolveIosVersion({ targets: agreeing, xcodeTarget: '' })).toEqual({})
  })
})

describe('readXcodeTargets', () => {
  test('reads the project inside the iOS folder', () => {
    const ios = join(tempDir(), 'ios')
    writeFile(join(ios, 'PLUS.xcodeproj', 'project.pbxproj'), PBXPROJ)
    expect(readXcodeTargets(ios).map((t) => t.name)).toContain('PLUSDevelopment')
  })

  test('returns null when there is no project or no folder', () => {
    expect(readXcodeTargets(tempDir())).toBeNull()
    expect(readXcodeTargets(join(tempDir(), 'missing'))).toBeNull()
  })
})
