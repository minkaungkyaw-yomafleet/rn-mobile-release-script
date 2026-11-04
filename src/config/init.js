import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { confirm } from '@inquirer/prompts'
import chalk from 'chalk'
import { ReleaseError } from '../lib/errors.js'
import { icon, info, note } from '../lib/ui.js'
import { renderTemplate, slugify } from './template.js'

/** `rnmrs --init`: asks before writing, and never overwrites without an explicit yes. */
export async function runInit({ cwd, yes }) {
  const packageJson = join(cwd, 'package.json')
  if (!existsSync(packageJson)) {
    throw new ReleaseError(`No package.json in ${cwd}.`, {
      hint: 'Run "rnmrs --init" from the root of your React Native project.',
    })
  }
  const target = join(cwd, 'rnmrs.config.yml')
  const exists = existsSync(target)

  let approved
  if (yes) {
    // --yes means "do not ask", not "overwrite": replacing a config needs an interactive yes.
    approved = !exists
  } else if (!process.stdin.isTTY) {
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

  const slug = slugify(basename(cwd))
  let projectName = basename(cwd)
  try {
    projectName = JSON.parse(readFileSync(packageJson, 'utf8')).name || projectName
  } catch {
    // An unreadable package.json is not worth failing init over; the folder name is a fine label.
  }
  writeFileSync(target, renderTemplate({ projectName, slug }), { flag: exists ? 'w' : 'wx' })

  console.log(`${icon.ok} Created ${chalk.bold('rnmrs.config.yml')}`)
  note('Next: check the RevoPush app names and env_files, then add this script to package.json:')
  note('"release": "rnmrs"')
}
