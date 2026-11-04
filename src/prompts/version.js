import semver from 'semver'

export const REVOPUSH_MIN_VERSION = '2.0.0'

/**
 * Blank is allowed for every release type: the tools then use the version already in the
 * native project (Info.plist / build.gradle). A provided version must be exact semver, and
 * RevoPush releases must be >= 2.0.0.
 */
export function checkVersion(input, type) {
  const raw = (input ?? '').trim()
  if (raw === '') return { ok: true, value: '' }

  const value = semver.valid(raw)
  if (!value) return { ok: false, message: `"${raw}" is not a valid version. Use x.y.z, for example 2.1.0.` }
  if (type === 'revopush' && semver.lt(value, REVOPUSH_MIN_VERSION)) {
    return { ok: false, message: `RevoPush releases need a version >= ${REVOPUSH_MIN_VERSION} (got ${value}).` }
  }
  return { ok: true, value }
}

/** Adapter for Inquirer's validate option: true, or the message to show. */
export const versionValidator = (type) => (input) => {
  const result = checkVersion(input, type)
  return result.ok ? true : result.message
}
