import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ReleaseError } from './errors.js'

const SUPPORTED = ['bun', 'yarn', 'npm']

function readPackageJson(root) {
  try {
    return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  } catch {
    return null
  }
}

/**
 * Which package manager the project itself uses: the packageManager field wins, then the
 * lockfile. name is null when neither says (the caller falls back to what is installed).
 */
export function detectPackageManager(root) {
  const declared = readPackageJson(root)?.packageManager
  if (typeof declared === 'string') {
    const name = declared.split('@')[0]
    if (!SUPPORTED.includes(name)) {
      throw new ReleaseError(`Unsupported package manager "${name}".`, {
        hint: `rnmrs supports ${SUPPORTED.join(', ')}.`,
      })
    }
    return { name, source: 'packageManager field' }
  }
  if (existsSync(join(root, 'bun.lock')) || existsSync(join(root, 'bun.lockb'))) return { name: 'bun', source: 'bun lockfile' }
  if (existsSync(join(root, 'yarn.lock'))) return { name: 'yarn', source: 'yarn.lock' }
  if (existsSync(join(root, 'package-lock.json'))) return { name: 'npm', source: 'package-lock.json' }
  return { name: null, source: 'no lockfile' }
}

/** First installed manager, in the same preference order the old clean scripts used. */
export function fallbackPackageManager(tools) {
  return SUPPORTED.find((name) => tools[name]?.found) ?? null
}

export function majorOf(version) {
  const match = /\d+/.exec(version ?? '')
  return match ? Number(match[0]) : null
}

/**
 * Reproducible installs only: a release must not silently rewrite the lockfile.
 * Yarn 2+ (berry) and yarn 1 spell the flag differently.
 */
export function installCommand(name, yarnMajor) {
  switch (name) {
    case 'bun':
      return ['bun', 'install', '--frozen-lockfile']
    case 'yarn':
      return yarnMajor !== null && yarnMajor >= 2 ? ['yarn', 'install', '--immutable'] : ['yarn', 'install', '--frozen-lockfile']
    case 'npm':
      return ['npm', 'ci']
    default:
      throw new ReleaseError(`Cannot install with "${name}".`)
  }
}
