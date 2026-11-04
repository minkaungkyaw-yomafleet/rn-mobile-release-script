import { readFileSync } from 'node:fs'
import chalk from 'chalk'
import { Command, Option } from 'commander'
import { runInit } from './config/init.js'
import { describeCommand, flagsForCommand } from './config/commands.js'
import { runGenerate } from './config/generate.js'
import { loadConfig } from './config/load.js'
import { parseToolList } from './config/tools.js'
import { ReleaseError } from './lib/errors.js'
import { currentRuntime } from './lib/runtime.js'
import { runPipeline } from './pipeline/index.js'
import { collectAnswers } from './prompts/index.js'
import { printError } from './lib/ui.js'

export function buildProgram() {
  return new Command()
    .name('rnmrs')
    .description('Release a React Native app: Fastlane binary builds or RevoPush OTA updates.')
    .argument('[command]', 'a shortcut from the commands section of rnmrs.config.yml, for example revo_android_development')
    .option('--commands', 'list the shortcut commands in rnmrs.config.yml')
    .option('--generate', 'add shortcut commands (revo_android_development, ...) built from the apps and environments in the config')
    .option('--init', 'create a rnmrs.config.yml in the current project, asking which release tools you use')
    .option('--with <tools>', 'with --init: the tools to configure, comma separated (fastlane, revopush), instead of asking')
    .addOption(new Option('-t, --type <type>', 'release type').choices(['revopush', 'binary']))
    .option('-a, --app <application-name>', 'RevoPush application from the config (also selects the platform)')
    .addOption(new Option('-p, --platform <platform>', 'platform, when no application is given').choices(['android', 'ios']))
    .option('-e, --env <environment>', 'environment from the config, for example Development or Production')
    .option('-v, --version <version-number>', 'release version, exact x.y.z (blank uses the version in the native project)')
    .option('-d, --description <description-text>', 'release description')
    .option('-y, --yes', 'answer confirmations with yes (required for unattended releases)')
    .option('--no-clean', 'skip cache and build-output cleanup')
    .option('--dry-run', 'run the read-only checks and print what would run, without changing anything')
    .option('-V, --cli-version', 'print the rnmrs version')
    .option('--runtime', 'print which JavaScript runtime rnmrs is running on (bun, node or deno)')
    .addHelpText(
      'after',
      `
Examples:
  rnmrs                                            guided prompts
  rnmrs revo_android_development                   a shortcut from the config; asks for version and description
  rnmrs --generate                                 add shortcut commands built from your config
  rnmrs --commands                                 list the shortcuts
  rnmrs -t revopush -a plus-mobile-android -e Development -d "Hotfix for master branch"
  rnmrs -t binary -p ios -e Qa --yes               unattended binary release
  rnmrs --dry-run -t binary -p android -e Staging  preview without changing anything`,
    )
}

function packageVersion() {
  const file = new URL('../package.json', import.meta.url)
  return JSON.parse(readFileSync(file, 'utf8')).version
}

function printCommands(config) {
  const names = Object.keys(config.commands)
  if (names.length === 0) {
    console.log('There are no shortcut commands in rnmrs.config.yml. Add a "commands:" section (see the README), or run rnmrs --init in a project without a config.')
    return
  }
  const width = Math.max(...names.map((n) => n.length))
  console.log(chalk.bold('Shortcut commands') + chalk.dim('  (run one with: rnmrs <name>)'))
  for (const name of names) console.log(`  ${chalk.cyan(name.padEnd(width))}  ${describeCommand(config.commands[name])}`)
}

function printPlan({ config, answers, flags, commandName }) {
  const rows = [
    ['Project', config.projectName],
    ...(commandName ? [['Command', commandName]] : []),
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

async function release(flags, commandName) {
  const { config, file, projectRoot } = loadConfig(process.cwd())
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY)

  console.log(`${chalk.bold('rnmrs')} ${chalk.dim(`using ${file}`)}`)
  // A command stands in for the type, application or platform, and environment flags.
  const effective = commandName ? flagsForCommand(commandName, config, flags) : flags
  const answers = await collectAnswers(config, effective, { interactive, askVersionAndDescription: Boolean(commandName) })
  printPlan({ config, answers, flags, commandName })

  await runPipeline({ config, projectRoot, answers, flags, interactive })
}

function listCommands() {
  printCommands(loadConfig(process.cwd()).config)
}

export async function main(argv) {
  const program = buildProgram()
  program.parse(argv)
  const flags = program.opts()
  const [commandName] = program.args

  try {
    if (flags.cliVersion) console.log(packageVersion())
    else if (flags.runtime) console.log(`${currentRuntime().name} ${currentRuntime().version}`)
    else if (flags.commands) listCommands()
    else if (flags.generate) await runGenerate({ cwd: process.cwd(), yes: Boolean(flags.yes), dryRun: Boolean(flags.dryRun) })
    else if (flags.init && commandName) throw new ReleaseError('--init does not take a command.', { hint: 'Run "rnmrs --init" on its own, then "rnmrs <command>".' })
    else if (flags.init) await runInit({ cwd: process.cwd(), yes: Boolean(flags.yes), tools: flags.with ? parseToolList(flags.with) : undefined })
    else if (flags.with) throw new ReleaseError('--with only works together with --init.', { hint: 'For example: rnmrs --init --with revopush' })
    else await release(flags, commandName)
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
