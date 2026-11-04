import { describe, expect, test } from 'bun:test'
import YAML from 'yaml'
import { afterAll } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { closestName, describeCommand, flagsForCommand } from '../src/config/commands.js'
import { addCommands, planCommands, runGenerate } from '../src/config/generate.js'
import { normalizeConfig } from '../src/config/schema.js'
import { renderTemplate } from '../src/config/template.js'
import { ReleaseError } from '../src/lib/errors.js'
import { collectAnswers } from '../src/prompts/index.js'
import { cleanupTempDirs, tempDir, writeFile } from './helpers.js'

afterAll(cleanupTempDirs)

const TEMPLATE = (tools) => renderTemplate({ projectName: 'plus', slug: 'plus-mobile', tools })
const configFor = (tools) => normalizeConfig(YAML.parse(TEMPLATE(tools)))
/** The config with the generated commands added, as `rnmrs --generate` would write it. */
const generated = (tools) => {
  const { text } = addCommands(TEMPLATE(tools), planCommands(configFor(tools)))
  return normalizeConfig(YAML.parse(text))
}

const base = {
  project_name: 'x',
  env_files: [{ path: '.env.qa', target: 'qa' }],
  revopush: { applications: [{ name: 'a-android', target: 'android' }, { name: 'a-ios', target: 'ios' }], environments: ['Development', 'Qa'] },
  fastlane: {},
}
const withCommands = (commands, over = {}) => ({ ...base, ...over, commands })
const problemsOf = (raw) => {
  try {
    normalizeConfig(raw)
  } catch (error) {
    expect(error).toBeInstanceOf(ReleaseError)
    return error.output
  }
  throw new Error('expected normalizeConfig to throw')
}

describe('init does not write commands, --generate does', () => {
  test('a fresh template has no commands section', () => {
    expect(TEMPLATE(['fastlane', 'revopush'])).not.toMatch(/^commands:/m)
    expect(configFor(['revopush']).commands).toEqual({})
  })
})

describe('planCommands', () => {
  test('one revo_<platform>_<env> per RevoPush app and environment, in small snake case', () => {
    const planned = planCommands(configFor(['revopush']))
    expect(planned.map((p) => p.name)).toEqual([
      'revo_android_development', 'revo_android_production', 'revo_android_qa', 'revo_android_staging',
      'revo_ios_development', 'revo_ios_production', 'revo_ios_qa', 'revo_ios_staging',
    ])
    expect(planned[0].entry).toEqual({ type: 'revopush', app: 'plus-mobile-android', env: 'Development' })
  })

  test('Fastlane gets fastlane_<platform>_<env> and only when it is configured', () => {
    expect(planCommands(configFor(['fastlane'])).map((p) => p.name)).toContain('fastlane_ios_qa')
    expect(planCommands(configFor(['fastlane'])).every((p) => p.name.startsWith('fastlane_'))).toBe(true)
    expect(planCommands(configFor(['revopush'])).some((p) => p.name.startsWith('fastlane_'))).toBe(false)
  })

  test('follows the environments you configured', () => {
    const config = normalizeConfig({
      ...base,
      revopush: { applications: [{ name: 'a-android', target: 'android' }], environments: ['Development', 'Pre Prod', 'Production'] },
      fastlane: undefined,
    })
    expect(planCommands(config).map((p) => p.name)).toEqual(['revo_android_development', 'revo_android_pre_prod', 'revo_android_production'])
  })

  test('with several apps on one platform the app name keeps the commands apart', () => {
    const config = normalizeConfig({
      ...base,
      revopush: { applications: [{ name: 'shop-android', target: 'android' }, { name: 'driver-android', target: 'android' }], environments: ['Qa'] },
      fastlane: undefined,
    })
    expect(planCommands(config).map((p) => p.name)).toEqual(['revo_shop_android_qa', 'revo_driver_android_qa'])
  })
})

describe('addCommands', () => {
  test('writes commands that the loader accepts, and a header that explains them', () => {
    const { text, added } = addCommands(TEMPLATE(['fastlane', 'revopush']), planCommands(configFor(['fastlane', 'revopush'])))
    expect(added).toHaveLength(16)
    expect(text).toContain('# Shortcuts: run one by name')
    expect(text).toContain('revo_android_development: { type: revopush, app: plus-mobile-android, env: Development }')
    expect(text).toContain('fastlane_ios_qa: { type: binary, platform: ios, env: Qa }')
    expect(Object.keys(normalizeConfig(YAML.parse(text)).commands)).toHaveLength(16)
  })

  test('leaves the rest of the file exactly as written, comments included', () => {
    const before = TEMPLATE(['fastlane', 'revopush'])
    const { text } = addCommands(before, planCommands(configFor(['fastlane', 'revopush'])))
    expect(text.startsWith(before.trimEnd())).toBe(true)
  })

  test('adds only what is missing and never changes a command you wrote or renamed', () => {
    const mine = `${TEMPLATE(['revopush'])}\ncommands:\n  hotfix: { type: revopush, app: plus-mobile-ios, env: Production }\n  revo_android_qa: { type: revopush, app: plus-mobile-ios, env: Staging }\n`
    const { text, added, kept } = addCommands(mine, planCommands(configFor(['revopush'])))
    const commands = normalizeConfig(YAML.parse(text)).commands
    expect(commands.hotfix).toMatchObject({ app: 'plus-mobile-ios', env: 'Production' })
    expect(commands.revo_android_qa).toMatchObject({ app: 'plus-mobile-ios', env: 'Staging' }) // not overwritten
    expect(text.match(/revo_android_qa:/g)).toHaveLength(1)
    // Kept: that name is taken, and two other commands are already covered by hotfix and the edited one.
    expect(kept.map((k) => k.name)).toEqual(['revo_android_qa', 'revo_ios_production', 'revo_ios_staging'])
    expect(added).toHaveLength(5)
  })

  test('a command you renamed does not come back under its generated name', () => {
    const renamed = `${TEMPLATE(['revopush'])}\ncommands:\n  dev_ota: { type: revopush, app: plus-mobile-android, env: development }\n`
    const { text, added, kept } = addCommands(renamed, planCommands(configFor(['revopush'])))
    expect(kept.map((k) => k.name)).toEqual(['revo_android_development'])
    expect(added).toHaveLength(7)
    expect(text).not.toContain('revo_android_development')
    expect(Object.keys(normalizeConfig(YAML.parse(text)).commands)).toContain('dev_ota')
  })

  test('a Fastlane command is matched by platform and environment, not by name', () => {
    const renamed = `${TEMPLATE(['fastlane'])}\ncommands:\n  ship_ios: { type: binary, platform: ios, env: Qa }\n`
    const { text } = addCommands(renamed, planCommands(configFor(['fastlane'])))
    expect(text).not.toContain('fastlane_ios_qa')
  })

  test('running it again adds nothing', () => {
    const first = addCommands(TEMPLATE(['revopush']), planCommands(configFor(['revopush'])))
    const second = addCommands(first.text, planCommands(configFor(['revopush'])))
    expect(second.added).toEqual([])
    expect(second.kept).toHaveLength(8)
    expect(second.text).toBe(first.text)
  })

  test('an empty commands: key is filled in', () => {
    const { text, added } = addCommands(`${TEMPLATE(['revopush'])}\ncommands:\n`, planCommands(configFor(['revopush'])))
    expect(added).toHaveLength(8)
    expect(Object.keys(normalizeConfig(YAML.parse(text)).commands)).toHaveLength(8)
  })
})

describe('runGenerate', () => {
  const project = (tools = ['fastlane', 'revopush']) => {
    const root = tempDir()
    writeFile(join(root, 'package.json'), '{}')
    writeFile(join(root, 'rnmrs.config.yml'), TEMPLATE(tools))
    return { root, file: join(root, 'rnmrs.config.yml') }
  }

  test('--yes writes the commands', async () => {
    const { root, file } = project(['revopush'])
    await runGenerate({ cwd: root, yes: true, dryRun: false })
    expect(Object.keys(normalizeConfig(YAML.parse(readFileSync(file, 'utf8'))).commands)).toHaveLength(8)
  })

  test('--dry-run shows them and writes nothing', async () => {
    const { root, file } = project()
    const before = readFileSync(file, 'utf8')
    await runGenerate({ cwd: root, yes: true, dryRun: true })
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  test('without --yes and without a terminal it refuses instead of writing', async () => {
    const { root, file } = project()
    const before = readFileSync(file, 'utf8')
    await expect(runGenerate({ cwd: root, yes: false, dryRun: false })).rejects.toThrow(/needs confirmation/)
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  test('with no config it says to run --init', async () => {
    await expect(runGenerate({ cwd: tempDir(), yes: true, dryRun: false })).rejects.toThrow(/No rnmrs.config.yml/)
  })
})

describe('the commands --generate adds', () => {
  test('RevoPush: one per platform and environment, in small snake case, such as revo_android_development', () => {
    const { commands } = generated(['revopush'])
    expect(Object.keys(commands)).toHaveLength(8)
    expect(commands.revo_android_development).toEqual({ type: 'revopush', app: 'plus-mobile-android', platform: 'android', env: 'Development' })
    expect(commands.revo_ios_production).toEqual({ type: 'revopush', app: 'plus-mobile-ios', platform: 'ios', env: 'Production' })
    for (const name of Object.keys(commands)) expect(name).toMatch(/^[a-z][a-z0-9_]*$/)
  })

  test('Fastlane: binary commands per platform and environment', () => {
    const { commands } = generated(['fastlane'])
    expect(Object.keys(commands)).toHaveLength(8)
    expect(commands.fastlane_ios_qa).toEqual({ type: 'binary', app: '', platform: 'ios', env: 'Qa' })
  })

  test('only the commands for the tools you chose are written', () => {
    expect(Object.keys(generated(['revopush']).commands).every((n) => n.startsWith('revo_'))).toBe(true)
    expect(Object.keys(generated(['fastlane']).commands).every((n) => n.startsWith('fastlane_'))).toBe(true)
    expect(Object.keys(generated(['fastlane', 'revopush']).commands)).toHaveLength(16)
  })
})

describe('validating the commands section', () => {
  test('an absent section is fine and gives no commands', () => {
    expect(normalizeConfig(base).commands).toEqual({})
  })

  test('env is matched without regard to case and stored as configured; the app gives the platform', () => {
    const { commands } = normalizeConfig(withCommands({ r: { type: 'revopush', app: 'a-ios', env: 'development' } }))
    expect(commands.r).toEqual({ type: 'revopush', app: 'a-ios', platform: 'ios', env: 'Development' })
  })

  test.each([
    ['Revo-Android', { type: 'revopush', app: 'a-android', env: 'Qa' }, 'small letters, digits and underscores'],
    ['1_revo', { type: 'revopush', app: 'a-android', env: 'Qa' }, 'starting with a letter'],
    ['r', { type: 'revopush', app: 'a-android', env: 'Staging' }, 'env must be one of: Development, Qa'],
    ['r', { type: 'revopush', app: 'nope', env: 'Qa' }, 'app must be one of: a-android, a-ios'],
    ['r', { type: 'revopush', app: 'a-android', platform: 'android', env: 'Qa' }, 'platform is not needed for revopush'],
    ['r', { type: 'binary', env: 'Qa' }, 'platform must be android or ios'],
    ['r', { type: 'binary', platform: 'ios', app: 'a-ios', env: 'Qa' }, 'app is only for revopush'],
    ['r', { type: 'codepush', env: 'Qa' }, 'type must be revopush or binary'],
    ['r', { type: 'revopush', app: 'a-android', env: 'Qa', mandatory: true }, 'mandatory is not a known key'],
  ])('rejects %s %j', (name, def, message) => {
    expect(problemsOf(withCommands({ [name]: def }))).toContain(message)
  })

  test('a command for a tool that is not set up says which section to add', () => {
    const noRevopush = { ...base, revopush: undefined, commands: { r: { type: 'revopush', app: 'a-android', env: 'Qa' } } }
    expect(problemsOf(noRevopush)).toContain('type revopush needs a revopush section')
    const noFastlane = withCommands({ b: { type: 'binary', platform: 'ios', env: 'Qa' } }, { fastlane: undefined })
    expect(problemsOf(noFastlane)).toContain('type binary needs a fastlane section')
  })

  test('reports every problem at once, and a non-mapping section', () => {
    const out = problemsOf(withCommands({ Bad: { type: 'x' }, ok: { type: 'revopush', app: 'a-ios', env: 'Qa' }, other: 'text' }))
    expect(out).toContain('commands.Bad')
    expect(out).toContain('commands.other must be')
    expect(problemsOf(withCommands(['a']))).toContain('commands must map a command name')
  })
})

describe('describeCommand and closestName', () => {
  test('say what a command does', () => {
    expect(describeCommand({ type: 'revopush', app: 'a-android', platform: 'android', env: 'Development' })).toBe('RevoPush, a-android (android), Development')
    expect(describeCommand({ type: 'binary', app: '', platform: 'ios', env: 'Qa' })).toBe('Fastlane binary, ios, Qa')
  })

  test('suggests the near miss, and nothing for a far one', () => {
    const names = ['revo_android_development', 'revo_ios_qa']
    expect(closestName('revo_android_developmnt', names)).toBe('revo_android_development')
    expect(closestName('REVO_IOS_QA', names)).toBe('revo_ios_qa')
    expect(closestName('deploy', names)).toBeNull()
    expect(closestName('x', [])).toBeNull()
  })
})

describe('flagsForCommand', () => {
  const config = generated(['fastlane', 'revopush'])

  test('stands in for the type, application and environment, and keeps the other flags', () => {
    const flags = flagsForCommand('revo_android_development', config, { version: '0.1.0', description: 'hi', yes: true })
    expect(flags).toMatchObject({ type: 'revopush', app: 'plus-mobile-android', platform: 'android', env: 'Development', version: '0.1.0', description: 'hi', yes: true })
  })

  test('a binary command gives a platform and no app', () => {
    expect(flagsForCommand('fastlane_ios_qa', config, {})).toMatchObject({ type: 'binary', platform: 'ios', env: 'Qa', app: undefined })
  })

  test('an unknown name suggests the nearest, or points at the list', () => {
    const near = (() => {
      try {
        flagsForCommand('revo_android_developmnt', config, {})
      } catch (e) {
        return e
      }
    })()
    expect(near.message).toContain('Unknown command "revo_android_developmnt"')
    expect(near.hint).toContain('Did you mean "revo_android_development"')
    expect(() => flagsForCommand('zzzz', config, {})).toThrow(/Unknown command/)
  })

  test('flags that contradict the command are refused instead of silently winning', () => {
    const error = (() => {
      try {
        flagsForCommand('revo_android_development', config, { env: 'Production' })
      } catch (e) {
        return e
      }
    })()
    expect(error.message).toContain('already sets')
    expect(error.hint).toContain('--env')
  })

  test('with no commands configured the error says how to add them', () => {
    const noCommands = { ...config, commands: {} }
    expect(() => flagsForCommand('revo_android_development', noCommands, {})).toThrow(/Unknown command/)
    try {
      flagsForCommand('revo_android_development', noCommands, {})
    } catch (e) {
      expect(e.hint).toContain('no commands section')
    }
  })
})

describe('a command through collectAnswers', () => {
  const config = generated(['fastlane', 'revopush'])
  const run = (name, extra = {}) => collectAnswers(config, flagsForCommand(name, config, extra), { interactive: false, askVersionAndDescription: true })

  test('gives the release the command describes, with version and description optional', async () => {
    const answers = await run('revo_android_development')
    expect(answers).toMatchObject({ type: 'revopush', platform: 'android', environment: 'Development', version: '', description: '' })
    expect(answers.app.name).toBe('plus-mobile-android')
  })

  test('takes a version and description from flags, and a binary command needs no app', async () => {
    expect(await run('revo_ios_qa', { version: '0.1.0', description: 'Fix' })).toMatchObject({ version: '0.1.0', description: 'Fix', platform: 'ios' })
    expect(await run('fastlane_ios_staging')).toMatchObject({ type: 'binary', platform: 'ios', environment: 'Staging', app: null })
  })
})
