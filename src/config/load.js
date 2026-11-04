import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import YAML from 'yaml'
import { ReleaseError } from '../lib/errors.js'
import { normalizeConfig } from './schema.js'

export const CONFIG_NAMES = ['rnmrs.config.yml', 'rnmrs.config.yaml']

/** Walks up from startDir so rnmrs works from a subfolder of the project. */
export function findConfigFile(startDir) {
  let dir = resolve(startDir)
  for (;;) {
    for (const name of CONFIG_NAMES) {
      const candidate = join(dir, name)
      if (existsSync(candidate)) return candidate
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

export function loadConfig(startDir) {
  const file = findConfigFile(startDir)
  if (!file) {
    throw new ReleaseError('No rnmrs.config.yml found in this directory or any parent.', {
      hint: 'Run "rnmrs --init" in the root of your React Native project.',
    })
  }
  let raw
  try {
    raw = YAML.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new ReleaseError(`${file} is not valid YAML.`, { output: error.message })
  }
  return { config: normalizeConfig(raw, file), file, projectRoot: dirname(file) }
}
