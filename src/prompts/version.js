import semver from 'semver'

/**
 * The release version. Blank is allowed: the tools then use the version already in the native
 * project (Info.plist / build.gradle). A provided version must be an exact x.y.z, with no
 * minimum, so 0.1.0 is as valid as 2.4.0. For RevoPush it is passed as the target binary version.
 */
export function checkVersion(input) {
  const raw = (input ?? '').trim()
  if (raw === '') return { ok: true, value: '' }

  const value = semver.valid(raw)
  if (!value) return { ok: false, message: `"${raw}" is not a valid version. Use x.y.z, for example 0.1.0 or 2.1.0.` }
  return { ok: true, value }
}

/** Adapter for Inquirer's validate option: true, or the message to show. */
export const versionValidator = (input) => {
  const result = checkVersion(input)
  return result.ok ? true : result.message
}
