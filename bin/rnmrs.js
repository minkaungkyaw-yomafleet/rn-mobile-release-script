#!/usr/bin/env node
// rnmrs runs on Bun, Node or Deno. npm and Yarn start bins with Node, so this entry point picks the
// runtime: Bun when it is installed (fastest to start, and what rnmrs is developed on), otherwise
// whatever started us (Node, or Deno when run with `deno run`). RNMRS_RUNTIME=bun|node|deno forces
// one. Written to run unchanged on all three, and it must stay that way: it is what starts them.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const COMMANDS = {
  bun: (file) => ['bun', [file]],
  node: (file) => ['node', [file]],
  deno: (file) => ['deno', ['run', '-A', file]],
}

const here = typeof Bun !== 'undefined' ? 'bun' : typeof Deno !== 'undefined' ? 'deno' : 'node'
const requested = process.env.RNMRS_RUNTIME?.trim().toLowerCase() || undefined

if (requested && !COMMANDS[requested]) {
  console.error(`RNMRS_RUNTIME must be bun, node or deno (got "${requested}").`)
  process.exit(1)
}

const isInstalled = (name) => {
  const probe = spawnSync(name, ['--version'], { stdio: 'ignore' })
  return !probe.error && probe.status === 0
}

// A process we started ourselves never hands over again, so two runtimes cannot bounce between each other.
const handedOver = process.env.RNMRS_HANDED_OVER === '1'
const target = requested ?? (here !== 'bun' && !handedOver && isInstalled('bun') ? 'bun' : here)

if (target === here) {
  const { main } = await import('../src/cli.js')
  await main(process.argv)
} else {
  const [command, args] = COMMANDS[target](fileURLToPath(import.meta.url))
  const result = spawnSync(command, [...args, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, RNMRS_HANDED_OVER: '1' },
  })
  if (result.error?.code === 'ENOENT') {
    console.error(`rnmrs could not find ${command} on your PATH (RNMRS_RUNTIME=${target}).`)
    process.exit(1)
  }
  if (result.error) {
    console.error(`rnmrs could not start ${command}: ${result.error.message}`)
    process.exit(1)
  }
  // A signal (for example Ctrl+C) has no exit status; report it the way a shell does.
  process.exit(result.status ?? (result.signal === 'SIGINT' ? 130 : 1))
}
