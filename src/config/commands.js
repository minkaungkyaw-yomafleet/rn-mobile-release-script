import { ReleaseError } from '../lib/errors.js'

// Shortcuts from the `commands:` section of rnmrs.config.yml: `rnmrs revo_android_development` is
// "RevoPush, the android app, the Development environment". The name is the developer's to choose.

const NAME = /^[a-z][a-z0-9_]*$/
const KEYS = ['type', 'app', 'platform', 'env']
const PLATFORMS = ['android', 'ios']
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const text = (v) => (typeof v === 'string' ? v.trim() : '')

/**
 * Validates the raw `commands` section against what the config sets up, pushing every problem onto
 * `problems`. Returns { name: { type, app, platform, env } } for the valid ones, with env in its
 * configured spelling (Development) and platform filled in from the app for RevoPush.
 */
export function collectCommands(raw, { revopush, fastlaneEnabled, environments }, problems) {
  const commands = {}
  if (raw === undefined || raw === null) return commands
  if (!isObject(raw)) {
    problems.push('commands must map a command name to { type, app or platform, env }')
    return commands
  }

  for (const [name, def] of Object.entries(raw)) {
    const at = `commands.${name}`
    const before = problems.length

    if (!NAME.test(name)) problems.push(`${at}: use small letters, digits and underscores, starting with a letter (for example revo_android_development)`)
    if (!isObject(def)) {
      problems.push(`${at} must be { type, app or platform, env }`)
      continue
    }
    for (const key of Object.keys(def)) if (!KEYS.includes(key)) problems.push(`${at}.${key} is not a known key (use ${KEYS.join(', ')})`)

    const type = text(def.type)
    const env = environments.find((e) => e.toLowerCase() === text(def.env).toLowerCase())
    if (!env) problems.push(`${at}.env must be one of: ${environments.join(', ')}`)

    let app = ''
    let platform = ''
    if (type === 'revopush') {
      if (!revopush) {
        problems.push(`${at}: type revopush needs a revopush section`)
      } else {
        const found = revopush.applications.find((a) => a.name === text(def.app))
        if (!found) {
          problems.push(`${at}.app must be one of: ${revopush.applications.map((a) => a.name).join(', ')}`)
        } else {
          app = found.name
          platform = found.target
        }
      }
      if (def.platform !== undefined) problems.push(`${at}.platform is not needed for revopush: the app sets it`)
    } else if (type === 'binary') {
      if (!fastlaneEnabled) problems.push(`${at}: type binary needs a fastlane section`)
      platform = text(def.platform).toLowerCase()
      if (!PLATFORMS.includes(platform)) problems.push(`${at}.platform must be android or ios`)
      if (def.app !== undefined) problems.push(`${at}.app is only for revopush`)
    } else {
      problems.push(`${at}.type must be revopush or binary`)
    }

    if (problems.length === before) commands[name] = { type, app, platform, env }
  }
  return commands
}

/** One line saying what a command does, for lists and the release plan. */
export function describeCommand(command) {
  return command.type === 'revopush'
    ? `RevoPush, ${command.app} (${command.platform}), ${command.env}`
    : `Fastlane binary, ${command.platform}, ${command.env}`
}

/** The command closest to a mistyped name, or null when nothing is near. */
export function closestName(name, names) {
  const distance = (a, b) => {
    const row = Array.from({ length: b.length + 1 }, (_, j) => j)
    for (let i = 1; i <= a.length; i++) {
      let diagonal = row[0]
      row[0] = i
      for (let j = 1; j <= b.length; j++) {
        const above = row[j]
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1))
        diagonal = above
      }
    }
    return row[b.length]
  }
  const wanted = name.toLowerCase()
  const ranked = names.map((n) => ({ n, d: distance(wanted, n) })).sort((x, y) => x.d - y.d)
  return ranked.length > 0 && ranked[0].d <= 3 ? ranked[0].n : null
}

/**
 * The flags a command stands for. A command already fixes the type, application or platform, and
 * environment, so passing those flags as well is a contradiction, not an override. Version,
 * description, --yes and the rest still apply.
 */
export function flagsForCommand(name, config, flags) {
  const command = config.commands[name]
  if (!command) {
    const names = Object.keys(config.commands)
    const near = closestName(name, names)
    throw new ReleaseError(`Unknown command "${name}".`, {
      hint: near
        ? `Did you mean "${near}"? Run "rnmrs --commands" to list them.`
        : names.length > 0
          ? 'Run "rnmrs --commands" to list the commands in rnmrs.config.yml.'
          : 'There is no commands section in rnmrs.config.yml. Add one (see the README), or run "rnmrs" without a command.',
    })
  }
  const clashing = ['type', 'app', 'platform', 'env'].filter((key) => flags[key] !== undefined)
  if (clashing.length > 0) {
    throw new ReleaseError(`The command ${name} already sets the release type, application or platform, and environment.`, {
      hint: `Remove ${clashing.map((k) => `--${k}`).join(', ')}, or run rnmrs without a command to choose them yourself.`,
    })
  }
  return { ...flags, type: command.type, app: command.app || undefined, platform: command.platform || undefined, env: command.env }
}
