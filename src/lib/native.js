import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ReleaseError } from './errors.js'
import { capture } from './exec.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const EXPECTED_PROTOCOL = 1
const OS_NAMES = { darwin: 'darwin', linux: 'linux' }
const ARCH_NAMES = { arm64: 'arm64', x64: 'amd64' }

export function nativeBinaryPath() {
  const os = OS_NAMES[process.platform]
  const arch = ARCH_NAMES[process.arch]
  if (!os || !arch) {
    throw new ReleaseError(`Unsupported platform ${process.platform}/${process.arch}.`, {
      hint: 'rnmrs supports macOS and Linux on arm64 or x64.',
    })
  }
  return join(ROOT, 'bin', 'native', `rnmrs-core-${os}-${arch}`)
}

/** Calls the Go core and returns its parsed JSON. Errors carry the core's stderr line. */
export async function core(args, { cwd } = {}) {
  const bin = nativeBinaryPath()
  if (!existsSync(bin)) {
    throw new ReleaseError('The native core binary is missing.', {
      hint: `Build it with "bun run build:native:current" in ${ROOT} (requires Go).`,
    })
  }
  const { code, stdout, stderr } = await capture(bin, args, { cwd })
  if (code !== 0) throw new ReleaseError(stderr.trim() || `rnmrs-core ${args[0]} failed (exit ${code})`)
  try {
    return JSON.parse(stdout)
  } catch {
    throw new ReleaseError(`rnmrs-core ${args[0]} returned invalid JSON.`, { output: stdout })
  }
}

/** Refuses to continue with a binary built against a different output contract. */
export async function assertCore() {
  const { protocol } = await core(['version'])
  if (protocol !== EXPECTED_PROTOCOL) {
    throw new ReleaseError(`Native core protocol ${protocol} does not match the CLI (${EXPECTED_PROTOCOL}).`, {
      hint: 'Rebuild it with "bun run build:native:current".',
    })
  }
}

export const preflight = (root, tools) => core(['preflight', '--root', root, '--tools', tools.join(',')])

export const cleanProject = (root, platform, { dryRun = false } = {}) =>
  core(['clean', '--root', root, '--platform', platform, ...(dryRun ? ['--dry-run'] : [])])

export const checkEnvFile = (root, file) => core(['envcheck', '--root', root, '--file', file])

export const readLanes = (dir) => core(['lanes', '--dir', dir])

export const checkFastlaneEnv = (dir) => core(['fastlane-env', '--dir', dir])
