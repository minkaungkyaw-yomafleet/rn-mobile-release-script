export const slugify = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'app'

/**
 * The generated rnmrs.config.yml. The slug seeds the RevoPush application names
 * (<slug>-android / <slug>-ios), which matches how our repos are named.
 */
export function renderTemplate({ projectName, slug }) {
  return `# rnmrs configuration. Edit the names below to match your RevoPush apps and env files.
project_name: ${JSON.stringify(projectName)}

# Env file per environment. A release stops if the mapped file is missing or empty.
env_files:
  - path: .env.development
    target: development
  - path: .env.qa
    target: qa
  - path: .env.staging
    target: staging
  - path: .env.production
    target: production

revopush:
  applications:
    - name: ${slug}-android
      target: android
    - name: ${slug}-ios
      target: ios
  environments:
    - Development
    - Production
    - Qa
    - Staging

fastlane:
  ios:
    path: "./ios"
  android:
    path: "./android"
  # true: read lanes from each Fastfile and pick the build/release pair per environment.
  # false: only use the lanes pinned under "lanes" below.
  auto_initialize_commands: true
  # Optional: pin lanes where discovery is ambiguous or you want them explicit.
  # lanes:
  #   android:
  #     production:
  #       build: android_production_build
  #       release: android_production_release
`
}
