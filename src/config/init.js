import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { checkbox, confirm } from '@inquirer/prompts'
import chalk from 'chalk'
import { ReleaseError } from '../lib/errors.js'
import { icon, info, note } from '../lib/ui.js'
import { TOOLS, detectTools } from './tools.js'
import { renderTemplate, slugify } from './template.js'

/**
 * Which tools to configure. Explicit (--with) wins. Otherwise a terminal gets a checkbox
 * (Space toggles, Enter confirms) with what the project already uses pre-ticked, and an
 * unattended --yes takes that same guess.
 */
async function chooseTools({ cwd, tools, interactive }) {
  if (tools) return tools

  const detected = detectTools(cwd)
  const anyDetected = TOOLS.some((t) => detected[t])
  // Nothing recognised: tick both, so Enter alone still gives the full template to trim.
  const preselect = (tool) => (anyDetected ? detected[tool] : true)
  if (!interactive) return TOOLS.filter(preselect)

  const found = (tool) => (detected[tool] ? chalk.dim('  (found in this project)') : '')
  const chosen = await checkbox({
    message: 'What do you release with? (Space to select, Enter to confirm)',
    choices: [
      { name: `Fastlane  native app builds and store releases${found('fastlane')}`, value: 'fastlane', checked: preselect('fastlane') },
      { name: `RevoPush  over-the-air JavaScript updates${found('revopush')}`, value: 'revopush', checked: preselect('revopush') },
    ],
    required: true,
  })
  return TOOLS.filter((t) => chosen.includes(t))
}

/** `rnmrs --init`: asks before writing, and never overwrites without an explicit yes. */
export async function runInit({ cwd, yes, tools }) {
  const packageJson = join(cwd, 'package.json')
  if (!existsSync(packageJson)) {
    throw new ReleaseError(`No package.json in ${cwd}.`, {
      hint: 'Run "rnmrs --init" from the root of your React Native project.',
    })
  }
  const target = join(cwd, 'rnmrs.config.yml')
  const exists = existsSync(target)
  const interactive = Boolean(process.stdin.isTTY)

  let approved
  if (yes) {
    // --yes means "do not ask", not "overwrite": replacing a config needs an interactive yes.
    approved = !exists
  } else if (!interactive) {
    throw new ReleaseError('--init needs confirmation but the session is not interactive.', { hint: 'Pass --yes to create the file without a prompt.' })
  } else {
    approved = await confirm({
      message: exists ? `${target} already exists. Overwrite it?` : `Create rnmrs.config.yml in ${cwd}?`,
      default: !exists,
    })
  }
  if (!approved) {
    info(exists ? 'Kept the existing rnmrs.config.yml.' : 'Nothing written.')
    return
  }

  const chosen = await chooseTools({ cwd, tools, interactive: interactive && !yes })

  const slug = slugify(basename(cwd))
  let projectName = basename(cwd)
  try {
    projectName = JSON.parse(readFileSync(packageJson, 'utf8')).name || projectName
  } catch {
    // An unreadable package.json is not worth failing init over; the folder name is a fine label.
  }
  writeFileSync(target, renderTemplate({ projectName, slug, tools: chosen }), { flag: exists ? 'w' : 'wx' })

  const names = { fastlane: 'Fastlane', revopush: 'RevoPush' }
  console.log(`${icon.ok} Created ${chalk.bold('rnmrs.config.yml')} for ${chosen.map((t) => names[t]).join(' and ')}`)
  const review = ['env_files']
  if (chosen.includes('revopush')) review.unshift('the RevoPush application names')
  if (chosen.includes('fastlane')) review.push('the Fastlane paths')
  note(`Next: check ${new Intl.ListFormat('en', { type: 'conjunction' }).format(review)}, then add this script to package.json:`)
  note('"release": "rnmrs"')
  note('Once the apps and environments are right, "rnmrs --generate" can add shortcut commands such as revo_android_development.')
}
