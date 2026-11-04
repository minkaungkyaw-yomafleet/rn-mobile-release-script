import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ReleaseError } from './errors.js'

// A project.pbxproj lists every native target (the app, test targets, notification or widget
// extensions) and each has its own MARKETING_VERSION. An app's Info.plist usually only says
// $(MARKETING_VERSION), so which target you ask decides the answer. RevoPush's CLI asks "the
// first one" when told nothing, which is how an app at 1.5.3 got a release targeted at 1.0.0 (the
// version of a notification extension). These helpers read the project so rnmrs can ask the right one.

const MARKETING_VERSION = /MARKETING_VERSION = "?([^";\n]+)"?;/

/** Native targets and their MARKETING_VERSION per build configuration, from a project.pbxproj text. */
export function parseXcodeTargets(pbxproj) {
  const versionByConfig = new Map()
  for (const block of pbxproj.matchAll(/\t\t([0-9A-F]{24}) \/\* [^*]+ \*\/ = \{\n\t\t\tisa = XCBuildConfiguration;[\s\S]*?\n\t\t\};/g)) {
    versionByConfig.set(block[1], MARKETING_VERSION.exec(block[0])?.[1].trim() ?? null)
  }

  const targets = []
  const lists = /\/\* Build configuration list for PBXNativeTarget "([^"]+)" \*\/ = \{\n\t\t\tisa = XCConfigurationList;\n\t\t\tbuildConfigurations = \(([\s\S]*?)\);/g
  for (const list of pbxproj.matchAll(lists)) {
    const versions = {}
    for (const ref of list[2].matchAll(/([0-9A-F]{24}) \/\* ([^*]+?) \*\//g)) versions[ref[2]] = versionByConfig.get(ref[1]) ?? null
    targets.push({ name: list[1], versions })
  }
  return targets
}

const concrete = (version) => (version && !version.includes('$(') ? version : null)

/** The version a target ships (Release first), or null when it is a variable such as $(APP_VERSION). */
export function targetVersion(target) {
  return concrete(target.versions.Release) ?? Object.values(target.versions).map(concrete).find(Boolean) ?? null
}

/** Targets of the Xcode project directly inside iosDir, or null when there is none to read. */
export function readXcodeTargets(iosDir) {
  try {
    const project = readdirSync(iosDir).find((name) => name.endsWith('.xcodeproj'))
    if (!project) return null
    return parseXcodeTargets(readFileSync(join(iosDir, project, 'project.pbxproj'), 'utf8'))
  } catch {
    return null
  }
}

/**
 * Which version an iOS RevoPush release targets when the developer did not type one.
 * Returns { version, via } (a concrete version), { xcodeTarget, via } (a variable RevoPush must
 * resolve for that target) or {} (every target agrees, so RevoPush cannot get it wrong).
 * Throws when targets disagree and nothing says which one is the app.
 */
export function resolveIosVersion({ targets, xcodeTarget }) {
  if (xcodeTarget) {
    const target = targets.find((t) => t.name === xcodeTarget)
    if (!target) {
      throw new ReleaseError(`The Xcode target "${xcodeTarget}" was not found in the project.`, {
        hint: `Targets in the project: ${targets.map((t) => t.name).join(', ')}. Fix revopush.applications[].xcode_targets in rnmrs.config.yml.`,
      })
    }
    const version = targetVersion(target)
    const via = `Xcode target ${xcodeTarget}`
    return version ? { version, via } : { xcodeTarget, via }
  }

  const found = targets.map((t) => ({ name: t.name, version: targetVersion(t) })).filter((t) => t.version)
  if (new Set(found.map((t) => t.version)).size > 1) {
    throw new ReleaseError('The Xcode project has targets with different versions, so RevoPush cannot tell which one is your app.', {
      output: found.map((t) => `${t.name}: ${t.version}`).join('\n'),
      hint: 'Set revopush.applications[].xcode_targets in rnmrs.config.yml (the target that holds the app version, per environment), or pass the version with -v.',
    })
  }
  return {}
}
