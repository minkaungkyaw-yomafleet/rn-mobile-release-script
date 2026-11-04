import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import YAML from 'yaml'
import { normalizeConfig } from '../src/config/schema.js'
import { renderTemplate } from '../src/config/template.js'

const made = []

/** A throwaway directory, removed by cleanupTempDirs(). Only ever deletes what it created. */
export function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'rnmrs-test-'))
  made.push(dir)
  return dir
}

export function cleanupTempDirs() {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
}

export function writeFile(path, content = '') {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

/** The config `rnmrs --init` would generate for a repo called plus-mobile. */
export function sampleConfig() {
  return normalizeConfig(YAML.parse(renderTemplate({ projectName: 'plus', slug: 'plus-mobile' })))
}

/** Lane lists copied from the real Fastfiles (dev-master) so resolution is tested against reality. */
const lane = (name, platform) => ({ name, private: false, platform, options: [], file: 'Fastfile', line: 1 })
export const PLUS_IOS = ['ios_development_build', 'ios_development_release', 'ios_qa_build', 'ios_qa_release', 'ios_production_build', 'ios_production_release', 'register_new_devices'].map((n) => lane(n, 'ios'))
export const PLUS_ANDROID = ['android_qa_build', 'android_qa_release', 'android_production_build', 'android_production_release', 'huawei_production_release'].map((n) => lane(n, 'android'))
export const BETTER_IOS = ['build_and_distribute_qa', 'distribute_qa', 'build_qa', 'release', 'prod', 'distribute_prod', 'build_prod', 'set_version'].map((n) => lane(n, 'ios'))
export const BETTER_ANDROID = ['build_dev', 'distribute_dev', 'build_and_distribute_dev', 'build_prod', 'prod'].map((n) => lane(n, 'android'))
