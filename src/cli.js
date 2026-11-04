import { readFileSync } from 'node:fs'
import chalk from 'chalk'
import { Command, Option } from 'commander'
import { runInit } from './config/init.js'
import { loadConfig } from './config/load.js'
import { runPipeline } from './pipeline/index.js'
import { collectAnswers } from './prompts/index.js'
import { printError } from './lib/ui.js'

export function buildProgram() {
  return new Command()
    .name('rnmrs')
    .description('Release a React Native app: Fastlane binary builds or RevoPush OTA updates.')
    .option('--init', 'create a rnmrs.config.yml template in the current project')
    .addOption(new Option('-t, --type <type>', 'release type').choices(['revopush', 'binary']))
    .option('-a, --app <application-name>', 'RevoPush application from the config (also selects the platform)')
    .addOption(new Option('-p, --platform <platform>', 'platform, when no application is given').choices(['android', 'ios']))
    .option('-e, --env <environment>', 'environment from the config, for example Development or Production')
    .option('-v, --version <version-number>', 'target version, exact x.y.z (RevoPush needs >= 2.0.0)')
    .option('-d, --description <description-text>', 'release description')
    .option('-y, --yes', 'answer confirmations with yes (required for unattended releases)')
    .option('--no-clean', 'skip cache and build-output cleanup')
    .option('--dry-run', 'run the read-only checks and print what would run, without changing anything')
    .option('-V, --cli-version', 'print the rnmrs version')
    .addHelpText(
      'after',
      `
Examples:
  rnmrs                                            guided prompts
  rnmrs -t revopush -a plus-mobile-android -e Development -d "Hotfix for master branch"
  rnmrs -t binary -p ios -e Qa --yes               unattended binary release
  rnmrs --dry-run -t binary -p android -e Staging  preview without changing anything`,
    )
}

function packageVersion() {
  const file = new URL('../package.json', import.meta.url)
  return JSON.parse(readFileSync(file, 'utf8')).version
}

function printPlan({ config, answers, flags }) {
  const rows = [
    ['Project', config.projectName],
    ['Type', answers.type],
    ['Platform', answers.platform],
    ...(answers.app ? [['Application', answers.app.name]] : []),
    ['Environment', answers.environment],
    ['Version', answers.version || chalk.dim('native project default')],
    ['Description', answers.description || chalk.dim('(none)')],
  ]
  console.log(`\n${chalk.bold('Release plan')}${flags.dryRun ? chalk.yellow('  (dry run)') : ''}`)
  for (const [label, value] of rows) console.log(`  ${chalk.dim(label.padEnd(12))} ${value}`)
}

async function release(flags) {
  const { config, file, projectRoot } = loadConfig(process.cwd())
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY)

  console.log(`${chalk.bold('rnmrs')} ${chalk.dim(`using ${file}`)}`)
  const answers = await collectAnswers(config, flags, { interactive })
  printPlan({ config, answers, flags })

  await runPipeline({ config, projectRoot, answers, flags, interactive })
}

export async function main(argv) {
  const program = buildProgram()
  program.parse(argv)
  const flags = program.opts()

  try {
    if (flags.cliVersion) console.log(packageVersion())
    else if (flags.init) await runInit({ cwd: process.cwd(), yes: Boolean(flags.yes) })
    else await release(flags)
  } catch (error) {
    // Inquirer throws this on Ctrl+C; it is a choice, not a failure.
    if (error?.name === 'ExitPromptError') {
      console.log(`\n${chalk.dim('Cancelled.')}`)
      process.exit(130)
    }
    printError(error)
    process.exit(1)
  }
}
