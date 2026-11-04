import { readFileSync, writeFileSync } from 'node:fs'
import { confirm } from '@inquirer/prompts'
import chalk from 'chalk'
import YAML from 'yaml'
import { ReleaseError } from '../lib/errors.js'
import { icon, info, note } from '../lib/ui.js'
import { describeCommand } from './commands.js'
import { loadConfig } from './load.js'
import { normalizeConfig } from './schema.js'

// `rnmrs --generate` builds the `commands:` shortcuts from the config you already have: one per
// RevoPush application and environment (revo_android_development) and one per platform and
// environment for Fastlane (fastlane_ios_qa). It only ever adds; commands you wrote or renamed stay.

const PLATFORMS = ['android', 'ios']
const snake = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

/** What a command does, ignoring its name: tool, the app (RevoPush) or platform (Fastlane), and environment. */
const definitionKey = (command) => `${command.type}|${command.type === 'revopush' ? command.app : command.platform}|${String(command.env).toLowerCase()}`

const HEADER = ` Shortcuts: run one by name, for example "rnmrs revo_android_development". Names are small letters and
 underscores, and you can rename, remove or add your own. The version and the release description are asked
 each time (both optional). "rnmrs --commands" lists them; "rnmrs --generate" adds any that are missing.`

/**
 * The shortcuts the config implies, in a stable order. With one RevoPush app per platform the name
 * uses the platform (revo_android_development); with several, the app name keeps them apart.
 */
export function planCommands(config) {
  const planned = []
  const apps = config.revopush?.applications ?? []
  for (const app of apps) {
    const shared = apps.filter((a) => a.target === app.target).length > 1
    for (const env of config.environments) {
      const name = `revo_${shared ? snake(app.name) : app.target}_${snake(env)}`
      planned.push({ name, entry: { type: 'revopush', app: app.name, env }, view: { type: 'revopush', app: app.name, platform: app.target, env } })
    }
  }
  if (config.fastlane.enabled) {
    for (const platform of PLATFORMS) {
      for (const env of config.environments) {
        planned.push({ name: `fastlane_${platform}_${snake(env)}`, entry: { type: 'binary', platform, env }, view: { type: 'binary', app: '', platform, env } })
      }
    }
  }
  return planned
}

/**
 * Adds the planned shortcuts that are not there yet to the YAML text. Everything else in the file,
 * comments included, is left as written. Returns { text, added, kept }.
 */
export function addCommands(yamlText, planned) {
  const doc = YAML.parseDocument(yamlText)
  // Keys made by the parser are scalars and keys made in code are plain strings; accept both.
  const pair = doc.contents.items.find((item) => (item.key?.value ?? item.key) === 'commands')
  let map = pair?.value
  if (!YAML.isMap(map)) {
    // Absent, or present but empty (`commands:` with nothing under it).
    map = doc.createNode({})
    if (pair) {
      pair.value = map
    } else {
      const key = doc.createNode('commands')
      key.spaceBefore = true
      key.commentBefore = HEADER
      doc.contents.add(doc.createPair(key, map))
    }
  }

  // A command counts as present under its own name, or under any other name when it does the same
  // thing: a command you renamed must not come back under its generated name.
  const existing = new Set(map.items.map((item) => String(item.key?.value ?? item.key)))
  const existingDefinitions = new Set()
  for (const item of map.items) {
    const definition = YAML.isNode(item.value) ? item.value.toJSON() : item.value
    if (definition && typeof definition === 'object') existingDefinitions.add(definitionKey(definition))
  }
  const added = []
  const kept = []
  for (const item of planned) {
    if (existing.has(item.name) || existingDefinitions.has(definitionKey(item.entry))) {
      kept.push(item)
      continue
    }
    const node = doc.createNode(item.entry)
    node.flow = true // one line per command: { type: revopush, app: my-app-android, env: Development }
    map.set(item.name, node)
    added.push(item)
  }
  return { text: doc.toString(), added, kept }
}

/** `rnmrs --generate`: shows what it would add, asks, then writes. --dry-run only shows. */
export async function runGenerate({ cwd, yes, dryRun }) {
  const { config, file } = loadConfig(cwd)
  const planned = planCommands(config)
  if (planned.length === 0) {
    throw new ReleaseError('Nothing to generate: the config has no RevoPush applications or Fastlane section.', {
      hint: 'Add a revopush or fastlane section to rnmrs.config.yml first.',
    })
  }

  const { text, added, kept } = addCommands(readFileSync(file, 'utf8'), planned)
  if (added.length === 0) {
    info(`All ${planned.length} commands are already in rnmrs.config.yml. Nothing to add.`)
    return
  }
  // Never write a file the loader would then reject.
  normalizeConfig(YAML.parse(text), file)

  const width = Math.max(...added.map((a) => a.name.length))
  console.log(chalk.bold(`Commands to add to ${file}`))
  for (const item of added) console.log(`  ${chalk.cyan(item.name.padEnd(width))}  ${describeCommand(item.view)}`)
  if (kept.length > 0) note(`${kept.length} already there (a renamed command counts), left as they are.`)

  if (dryRun) {
    info('Dry run: nothing was written.')
    return
  }
  if (!yes) {
    if (!process.stdin.isTTY) {
      throw new ReleaseError('--generate needs confirmation but the session is not interactive.', { hint: 'Pass --yes to write the commands without a prompt, or --dry-run to only list them.' })
    }
    if (!(await confirm({ message: `Add ${added.length} command${added.length === 1 ? '' : 's'} to rnmrs.config.yml?`, default: true }))) {
      info('Nothing written.')
      return
    }
  }

  writeFileSync(file, text)
  console.log(`${icon.ok} Added ${added.length} command${added.length === 1 ? '' : 's'} to ${chalk.bold('rnmrs.config.yml')}`)
  note(`Try: rnmrs ${added[0].name}    (rnmrs --commands lists them)`)
}
