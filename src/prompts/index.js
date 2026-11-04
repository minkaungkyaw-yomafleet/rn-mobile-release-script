import { input, select } from '@inquirer/prompts'
import { ReleaseError } from '../lib/errors.js'
import { info } from '../lib/ui.js'
import { PLATFORMS, appByName, matchEnvironment } from '../config/schema.js'
import { checkVersion, versionValidator } from './version.js'

const needFlag = (what, flag) =>
  new ReleaseError(`${what} is required in a non-interactive session.`, { hint: `Pass ${flag}.` })

/**
 * Resolves the six answers (type, platform, app, environment, version, description) from
 * flags first, prompting only for what is missing and only when a terminal is attached.
 *
 * When type, environment and an app or platform all come from flags, the run is treated as
 * fully specified (the CI / one-liner case): version and description are never prompted for.
 */
export async function collectAnswers(config, flags, { interactive, askVersionAndDescription = false }) {
  // 1. Release type: only what the config sets up is offered, and a single option needs no question.
  const available = [...(config.fastlane.enabled ? ['binary'] : []), ...(config.revopush ? ['revopush'] : [])]
  let type = flags.type
  if (type === 'binary' && !available.includes('binary')) {
    throw new ReleaseError('This project has no fastlane section in rnmrs.config.yml.', {
      hint: `Add a fastlane section (the ios and android paths)${available.includes('revopush') ? ', or use -t revopush' : ''}.`,
    })
  }
  if (type === 'revopush' && !available.includes('revopush')) {
    throw new ReleaseError('This project has no revopush section in rnmrs.config.yml.', {
      hint: `Add revopush.applications and revopush.environments${available.includes('binary') ? ', or use -t binary' : ''}.`,
    })
  }
  const onlyOne = !type && available.length === 1
  if (onlyOne) {
    type = available[0]
    info(`Release type: ${type} (the only tool in rnmrs.config.yml)`)
  }
  if (!type) {
    if (!interactive) throw needFlag('A release type', '-t revopush|binary')
    type = await select({
      message: 'Release type',
      choices: [
        { name: 'binary (Fastlane build + store/distribution release)', value: 'binary' },
        { name: 'revopush (over-the-air JS update)', value: 'revopush' },
      ],
    })
  }

  // When type, environment and an app or platform are all settled without asking, the run is fully
  // specified (the CI / one-liner case): version and description are never prompted for.
  // A shortcut command is fully specified too, but its version and description are still asked
  // (both optional): they change every release, so they cannot live in the config.
  const fullySpecified = Boolean((flags.type || onlyOne) && flags.env && (flags.app || flags.platform))
  const mayPrompt = interactive && (askVersionAndDescription || !fullySpecified)

  // 2 + 3. Platform and target application
  let platform = flags.platform
  let app = null
  if (flags.app) {
    app = appByName(config, flags.app)
    if (!app) {
      const names = config.revopush?.applications.map((a) => a.name).join(', ') || 'none configured'
      throw new ReleaseError(`Unknown application "${flags.app}".`, { hint: `Configured applications: ${names}.` })
    }
    if (platform && platform !== app.target) {
      throw new ReleaseError(`--platform ${platform} conflicts with ${app.name}, which targets ${app.target}.`)
    }
    platform = app.target
  }
  if (!platform) {
    if (!interactive) throw needFlag('A platform', '-p android|ios, or -a <application>')
    platform = await select({ message: 'Platform', choices: PLATFORMS.map((p) => ({ name: p, value: p })) })
  }
  if (type === 'revopush' && !app) {
    const candidates = config.revopush.applications.filter((a) => a.target === platform)
    if (candidates.length === 0) throw new ReleaseError(`No RevoPush application targets ${platform}.`, { hint: 'Add one under revopush.applications.' })
    if (candidates.length === 1) {
      app = candidates[0]
      info(`Application: ${app.name}`)
    } else if (!interactive) {
      throw needFlag('An application', '-a <application-name>')
    } else {
      const name = await select({ message: 'Target application', choices: candidates.map((a) => ({ name: a.name, value: a.name })) })
      app = candidates.find((a) => a.name === name)
    }
  }

  // 4. Environment
  let environment
  if (flags.env) {
    environment = matchEnvironment(config.environments, flags.env)
    if (!environment) {
      throw new ReleaseError(`Unknown environment "${flags.env}".`, { hint: `Configured environments: ${config.environments.join(', ')}.` })
    }
  } else {
    if (!interactive) throw needFlag('An environment', '-e <environment>')
    environment = await select({ message: 'Environment', choices: config.environments.map((e) => ({ name: e, value: e })) })
  }

  // 5. Version (optional; validated whichever way it arrives)
  let version = ''
  if (flags.version !== undefined) {
    const result = checkVersion(flags.version)
    if (!result.ok) throw new ReleaseError(result.message)
    version = result.value
  } else if (mayPrompt) {
    const message = 'Release version (blank = version in the native project)'
    version = checkVersion(await input({ message, validate: versionValidator })).value
  }

  // 6. Description (optional)
  let description = flags.description ?? ''
  if (flags.description === undefined && mayPrompt) {
    description = (await input({ message: 'Release description (optional)' })).trim()
  }

  return { type, platform, app, environment, version, description }
}
