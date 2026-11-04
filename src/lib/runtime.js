/** Which JavaScript runtime this process is running on: bun, deno or node. */
export function currentRuntime() {
  if (typeof Bun !== 'undefined') return { name: 'bun', version: Bun.version }
  if (typeof Deno !== 'undefined') return { name: 'deno', version: Deno.version.deno }
  return { name: 'node', version: process.versions.node }
}
