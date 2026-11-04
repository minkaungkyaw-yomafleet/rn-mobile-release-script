import { isAbsolute, normalize } from 'node:path'
import { ReleaseError } from '../lib/errors.js'
import { collectCommands } from './commands.js'

export const PLATFORMS = ['android', 'ios']

const LANE_NAME = /^\w+$/
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const text = (v) => (typeof v === 'string' ? v.trim() : '')
const staysInProject = (p) => !isAbsolute(p) && !normalize(p).split(/[\\/]/).includes('..')
const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * Validates the parsed YAML and returns a normalized config. All problems are reported
 * together so a broken file takes one edit to fix, not one per run.
 */
export function normalizeConfig(raw, source = 'rnmrs.config.yml') {
  if (!isObject(raw)) {
    throw new ReleaseError(`${source} is empty or not a YAML mapping.`, {
      hint: 'Run "rnmrs --init" to generate a valid template.',
    })
  }
  const problems = []

  const projectName = text(raw.project_name)
  if (!projectName) problems.push('project_name is required')

  const envFiles = []
  if (!Array.isArray(raw.env_files) || raw.env_files.length === 0) {
    problems.push('env_files must list at least one { path, target }')
  } else {
    raw.env_files.forEach((entry, i) => {
      const path = text(entry?.path)
      const target = text(entry?.target).toLowerCase()
      if (!path) problems.push(`env_files[${i}].path is required`)
      else if (!staysInProject(path)) problems.push(`env_files[${i}].path must stay inside the project: ${path}`)
      if (!target) problems.push(`env_files[${i}].target is required`)
      else if (envFiles.some((e) => e.target === target)) problems.push(`env_files has two entries for target "${target}"`)
      if (path && target && staysInProject(path)) envFiles.push({ path, target })
    })
  }

  let revopush = null
  if (raw.revopush !== undefined) {
    const section = raw.revopush
    const applications = []
    const environments = []
    if (!isObject(section)) {
      problems.push('revopush must be a mapping with applications and environments')
    } else {
      if (!Array.isArray(section.applications) || section.applications.length === 0) {
        problems.push('revopush.applications must list at least one { name, target }')
      } else {
        section.applications.forEach((app, i) => {
          const name = text(app?.name)
          const target = text(app?.target).toLowerCase()
          if (!name) problems.push(`revopush.applications[${i}].name is required`)
          else if (applications.some((a) => a.name === name)) problems.push(`revopush.applications has two entries named "${name}"`)
          if (!PLATFORMS.includes(target)) problems.push(`revopush.applications[${i}].target must be one of ${PLATFORMS.join(', ')}`)

          // Which Xcode target holds the app version, per environment (iOS only). Keys are lower-cased.
          const xcodeTargets = {}
          const rawTargets = app?.xcode_targets
          if (rawTargets !== undefined) {
            if (target !== 'ios') {
              problems.push(`revopush.applications[${i}].xcode_targets only applies to an application with target: ios`)
            } else if (!isObject(rawTargets)) {
              problems.push(`revopush.applications[${i}].xcode_targets must map environment names to Xcode target names`)
            } else {
              for (const [env, xcodeTarget] of Object.entries(rawTargets)) {
                if (text(xcodeTarget)) xcodeTargets[env.toLowerCase()] = text(xcodeTarget)
                else problems.push(`revopush.applications[${i}].xcode_targets.${env} must be a non-empty Xcode target name`)
              }
            }
          }
          if (name && PLATFORMS.includes(target)) applications.push({ name, target, xcodeTargets })
        })
      }
      if (section.environments !== undefined) {
        if (!Array.isArray(section.environments) || section.environments.length === 0) {
          problems.push('revopush.environments must be a non-empty list of names')
        } else {
          for (const [i, value] of section.environments.entries()) {
            const name = text(value)
            if (!name) problems.push(`revopush.environments[${i}] must be a non-empty string`)
            else if (environments.some((e) => e.toLowerCase() === name.toLowerCase())) problems.push(`revopush.environments lists "${name}" twice`)
            else environments.push(name)
          }
        }
      }
    }
    revopush = { applications, environments }
  }

  // A section being present is what says the tool is configured (`fastlane:` with nothing under it
  // still counts, and takes the defaults). Without it, binary releases are not offered.
  const fastlaneRaw = raw.fastlane ?? {}
  const fastlane = { enabled: raw.fastlane !== undefined, ios: { path: './ios' }, android: { path: './android' }, autoInitialize: true, lanes: {} }
  if (!fastlane.enabled && !revopush) problems.push('configure at least one release tool: a revopush section, a fastlane section, or both')
  if (!isObject(fastlaneRaw)) {
    problems.push('fastlane must be a mapping')
  } else {
    for (const platform of PLATFORMS) {
      const path = fastlaneRaw[platform]?.path
      if (path === undefined) continue
      if (!text(path)) problems.push(`fastlane.${platform}.path must be a non-empty string`)
      else if (!staysInProject(text(path))) problems.push(`fastlane.${platform}.path must stay inside the project: ${path}`)
      else fastlane[platform] = { path: text(path) }
    }
    if (fastlaneRaw.auto_initialize_commands !== undefined) {
      if (typeof fastlaneRaw.auto_initialize_commands === 'boolean') fastlane.autoInitialize = fastlaneRaw.auto_initialize_commands
      else problems.push('fastlane.auto_initialize_commands must be true or false')
    }
    if (fastlaneRaw.lanes !== undefined) collectLanes(fastlaneRaw.lanes, fastlane.lanes, problems)
  }

  // Environments default to the env_files targets so a config without a revopush section still works for binaries.
  const environments = revopush?.environments.length ? revopush.environments : envFiles.map((e) => titleCase(e.target))

  // An xcode_targets key that names no environment would never be used, which hides a typo.
  const known = environments.map((e) => e.toLowerCase())
  for (const app of revopush?.applications ?? []) {
    for (const env of Object.keys(app.xcodeTargets)) {
      if (!known.includes(env)) problems.push(`revopush.applications "${app.name}": xcode_targets.${env} is not one of the environments (${environments.join(', ')})`)
    }
  }

  const commands = collectCommands(raw.commands, { revopush, fastlaneEnabled: fastlane.enabled, environments }, problems)

  if (problems.length > 0) {
    throw new ReleaseError(`Invalid ${source}:`, { output: problems.map((p) => `- ${p}`).join('\n') })
  }

  return { projectName, envFiles, revopush, environments, fastlane, commands }
}

function collectLanes(raw, out, problems) {
  if (!isObject(raw)) {
    problems.push('fastlane.lanes must map platform -> environment -> { build, release }')
    return
  }
  for (const [platform, byEnv] of Object.entries(raw)) {
    if (!PLATFORMS.includes(platform)) {
      problems.push(`fastlane.lanes.${platform}: platform must be one of ${PLATFORMS.join(', ')}`)
      continue
    }
    if (!isObject(byEnv)) {
      problems.push(`fastlane.lanes.${platform} must map environment names to { build, release }`)
      continue
    }
    out[platform] = {}
    for (const [env, lanes] of Object.entries(byEnv)) {
      const entry = {}
      for (const kind of ['build', 'release']) {
        if (lanes?.[kind] === undefined) continue
        if (typeof lanes[kind] === 'string' && LANE_NAME.test(lanes[kind])) entry[kind] = lanes[kind]
        else problems.push(`fastlane.lanes.${platform}.${env}.${kind} must be a lane name`)
      }
      if (!entry.build && !entry.release) problems.push(`fastlane.lanes.${platform}.${env} needs a build or release lane`)
      out[platform][env.toLowerCase()] = entry
    }
  }
}

export const envFileFor = (config, environment) => config.envFiles.find((e) => e.target === environment.toLowerCase())

export const appByName = (config, name) => config.revopush?.applications.find((a) => a.name === name)

export const matchEnvironment = (environments, input) => environments.find((e) => e.toLowerCase() === input.trim().toLowerCase())
