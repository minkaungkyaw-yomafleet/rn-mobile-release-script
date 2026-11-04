import { select } from '@inquirer/prompts'
import { ReleaseError } from '../lib/errors.js'
import { pickLane } from './lanePolicy.js'

// Environment name -> the words lane names use for it (build_dev, android_production_release, ...).
const ENV_ALIASES = {
  development: ['development', 'dev'],
  qa: ['qa'],
  staging: ['staging', 'stage'],
  production: ['production', 'prod'],
}
const RELEASE_WORDS = ['distribute', 'release', 'upload']

export function envAliases(env) {
  const key = env.toLowerCase()
  const group = Object.values(ENV_ALIASES).find((aliases) => aliases.includes(key))
  return group ?? [key]
}

/**
 * What a lane does for this environment, judged from its name:
 *   build_dev               -> build
 *   distribute_dev          -> release   (uploads an existing build)
 *   build_and_distribute_dev-> both
 *   prod                    -> release   (a bare environment name is the "ship it" lane)
 * Returns null when the lane is not about this environment at all.
 */
export function classifyLane(name, aliases) {
  const tokens = name.toLowerCase().split('_')
  if (!tokens.some((t) => aliases.includes(t))) return null
  const build = tokens.includes('build')
  const release = tokens.some((t) => RELEASE_WORDS.includes(t))
  if (build && release) return 'both'
  if (build) return 'build'
  if (release) return 'release'
  return tokens.every((t) => aliases.includes(t)) ? 'release' : null
}

export function groupLanes(lanes, env) {
  const aliases = envAliases(env)
  const groups = { build: [], release: [], both: [] }
  for (const lane of lanes) {
    if (lane.private) continue
    const kind = classifyLane(lane.name, aliases)
    if (kind) groups[kind].push({ ...lane, tokens: lane.name.toLowerCase().split('_') })
  }
  return groups
}

async function choose(kind, candidates, ctx, ask) {
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]

  const picked = pickLane(candidates, { platform: ctx.platform, env: ctx.env, kind })
  const hit = picked ? candidates.find((c) => c.name === picked) : null
  if (hit) return hit

  const names = candidates.map((c) => c.name).join(', ')
  if (!ctx.interactive) {
    throw new ReleaseError(`Several ${kind} lanes match ${ctx.platform}/${ctx.env}: ${names}.`, {
      hint: `Pin one under fastlane.lanes.${ctx.platform}.${ctx.env.toLowerCase()} in rnmrs.config.yml.`,
    })
  }
  const name = await ask({
    message: `Which ${kind} lane for ${ctx.platform}/${ctx.env}?`,
    choices: candidates.map((c) => ({ name: c.desc ? `${c.name}  (${c.desc})` : c.name, value: c.name })),
  })
  return candidates.find((c) => c.name === name)
}

/**
 * Resolves which lane(s) to run. Returns one of:
 *   { build, release }   preferred: lets the CLI ask for confirmation between the two
 *   { single }           one lane that builds and releases
 *   { build } | { release }
 * `discovered` is empty when auto_initialize_commands is off, in which case `configured`
 * (fastlane.lanes in the config) is the only source.
 */
export async function resolveLanes({ discovered, configured, platform, env, interactive, ask = select }) {
  const byName = new Map(discovered.map((l) => [l.name, l]))
  // A pinned lane we could not read still runs; we just know nothing about its options.
  const pinned = (name) => byName.get(name) ?? { name, options: [], platform: '', tokens: [] }

  if (configured) {
    const out = {}
    if (configured.build) out.build = pinned(configured.build)
    if (configured.release) out.release = pinned(configured.release)
    return out
  }
  if (discovered.length === 0) {
    throw new ReleaseError(`No lanes are pinned for ${platform}/${env} and auto_initialize_commands is off.`, {
      hint: `Add fastlane.lanes.${platform}.${env.toLowerCase()} to rnmrs.config.yml, or set auto_initialize_commands: true.`,
    })
  }

  const ctx = { platform, env, interactive }
  const groups = groupLanes(discovered, env)
  const build = await choose('build', groups.build, ctx, ask)
  const release = await choose('release', groups.release, ctx, ask)
  if (build && release) return { build, release }

  const single = await choose('build-and-release', groups.both, ctx, ask)
  if (single) return { single }
  if (build) return { build }
  if (release) return { release }

  const available = discovered.filter((l) => !l.private).map((l) => l.name).join(', ')
  throw new ReleaseError(`No Fastlane lane matches ${platform}/${env}.`, {
    hint: `Available lanes: ${available || 'none'}. Pin one under fastlane.lanes in rnmrs.config.yml.`,
  })
}

/**
 * The command that runs a lane. Bundler is used when the project has a Gemfile, so the
 * Fastlane version matches what the team locked. The platform is only spelled out when the
 * lane's platform is not the Fastfile's default_platform. :version is passed only to lanes
 * that actually read options[:version].
 */
export function laneCommand({ lane, defaultPlatform, version, bundler }) {
  const platformArg = lane.platform && lane.platform !== defaultPlatform ? [lane.platform] : []
  const versionArg = version && lane.options?.includes('version') ? [`version:${version}`] : []
  const fastlane = [...platformArg, lane.name, ...versionArg]
  return bundler ? { cmd: 'bundle', args: ['exec', 'fastlane', ...fastlane] } : { cmd: 'fastlane', args: fastlane }
}

export const ignoresVersion = (lane, version) => Boolean(version) && !lane.options?.includes('version')
