/** An expected, user-facing failure: printed as a concise message instead of a stack trace. */
export class ReleaseError extends Error {
  /**
   * @param {string} message one line saying what failed
   * @param {{ hint?: string, output?: string }} [extra] hint: what to do next; output: captured tool output
   */
  constructor(message, { hint, output } = {}) {
    super(message)
    this.name = 'ReleaseError'
    this.hint = hint
    this.output = output
  }
}
