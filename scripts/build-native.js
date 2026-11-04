#!/usr/bin/env bun
// Builds the Go core into bin/native/rnmrs-core-<os>-<arch> and writes SHA256SUMS.
//   bun scripts/build-native.js            all supported targets (CI / prepack)
//   bun scripts/build-native.js --current  this machine only (local development)
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'bin', 'native')

const ALL_TARGETS = [
  ['darwin', 'arm64'],
  ['darwin', 'amd64'],
  ['linux', 'arm64'],
  ['linux', 'amd64'],
]
const hostTarget = [[process.platform, process.arch === 'arm64' ? 'arm64' : 'amd64']]
const targets = process.argv.includes('--current') ? hostTarget : ALL_TARGETS

mkdirSync(outDir, { recursive: true })

// GO=/path/to/go overrides which toolchain builds the core (useful with several Go installs).
const go = process.env.GO || 'go'

for (const [goos, goarch] of targets) {
  const name = `rnmrs-core-${goos}-${goarch}`
  const result = Bun.spawnSync(
    [go, 'build', '-trimpath', '-ldflags', '-s -w', '-o', join(outDir, name), '.'],
    {
      cwd: join(root, 'native'),
      env: { ...process.env, CGO_ENABLED: '0', GOOS: goos, GOARCH: goarch },
      stdout: 'inherit',
      stderr: 'inherit',
    },
  )
  if (result.exitCode !== 0) {
    console.error(`✖ ${name}`)
    process.exit(1)
  }
  console.log(`✔ ${name}`)
}

// Hash whatever is present so a partial (--current) build never produces a misleading file.
const sums = readdirSync(outDir)
  .filter((f) => f.startsWith('rnmrs-core-'))
  .sort()
  .map((f) => `${createHash('sha256').update(readFileSync(join(outDir, f))).digest('hex')}  ${f}`)
writeFileSync(join(outDir, 'SHA256SUMS'), `${sums.join('\n')}\n`)
