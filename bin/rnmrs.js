#!/usr/bin/env node
// rnmrs runs on Bun. npm and Yarn start bins with Node, so this entry point checks which runtime it
// is in: under Bun it runs the CLI, under Node it hands over to a `bun` on PATH, or explains how to
// get one. (A `bun` shebang would fail with a cryptic "env: bun: No such file" for Node-only users.)
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

if (typeof Bun !== 'undefined') {
  const { main } = await import('../src/cli.js')
  await main(process.argv)
} else {
  const result = spawnSync('bun', [fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' })
  if (result.error?.code === 'ENOENT') {
    console.error('rnmrs needs Bun, which was not found on your PATH.')
    console.error('Install it from https://bun.sh, then run rnmrs again.')
    process.exit(1)
  }
  if (result.error) {
    console.error(`rnmrs could not start Bun: ${result.error.message}`)
    process.exit(1)
  }
  // A signal (for example Ctrl+C) has no exit status; report it the way a shell does.
  process.exit(result.status ?? (result.signal === 'SIGINT' ? 130 : 1))
}
