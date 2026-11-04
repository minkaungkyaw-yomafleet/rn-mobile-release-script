import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ReleaseError } from '../lib/errors.js'

/** The release tools rnmrs can drive. A tool is "configured" when its section is in rnmrs.config.yml. */
export const TOOLS = ['fastlane', 'revopush']

/**
 * What this project already uses, so `rnmrs --init` can pre-tick the right boxes. A guess to save
 * a keystroke, never a decision: the developer confirms it.
 */
export function detectTools(cwd) {
  const fastlane = ['ios/fastlane/Fastfile', 'android/fastlane/Fastfile', 'fastlane/Fastfile'].some((file) => existsSync(join(cwd, file)))

  let revopush = false
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))
    const dependencies = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
    revopush = dependencies.some((name) => name.startsWith('@revopush/')) || JSON.stringify(pkg.scripts ?? {}).includes('revopush')
  } catch {
    // An unreadable package.json simply means nothing is detected.
  }
  return { fastlane, revopush }
}

/** "fastlane,revopush" -> ['fastlane', 'revopush']. Case-insensitive, order-preserving, no duplicates. */
export function parseToolList(value) {
  const names = String(value ?? '')
    .split(',')
    .map((n) => n.trim().toLowerCase())
    .filter(Boolean)
  const unknown = names.filter((n) => !TOOLS.includes(n))
  if (names.length === 0 || unknown.length > 0) {
    throw new ReleaseError(unknown.length > 0 ? `Unknown release tool "${unknown[0]}".` : '--with needs at least one release tool.', {
      hint: `Use ${TOOLS.join(', ')} (comma separated), for example --with revopush.`,
    })
  }
  return [...new Set(names)]
}
