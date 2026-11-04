export const slugify = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'app'

const REVOPUSH = (slug) => `revopush:
  applications:
    - name: ${slug}-android
      target: android
    - name: ${slug}-ios
      target: ios
      # Only if your Xcode project has several targets with different versions (for example
      # notification extensions still at 1.0.0): which target holds the app version, per environment.
      # Without it a release with a blank version stops, rather than guess the wrong target.
      # xcode_targets:
      #   Development: ${slug}Development
      #   Production: ${slug}
  environments:
    - Development
    - Production
    - Qa
    - Staging
`

const FASTLANE = `fastlane:
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

/**
 * The generated rnmrs.config.yml, with only the sections for the tools in use: a section being
 * present is what tells rnmrs a tool is configured. The slug seeds the RevoPush application names
 * (<slug>-android / <slug>-ios), which matches how our repos are named. Shortcut commands are not
 * written here: `rnmrs --generate` builds them from the config once its apps and environments are right.
 */
export function renderTemplate({ projectName, slug, tools = ['fastlane', 'revopush'] }) {
  const sections = [
    `# rnmrs configuration. Edit the names below to match your project.
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
`,
  ]
  if (tools.includes('revopush')) sections.push(REVOPUSH(slug))
  if (tools.includes('fastlane')) sections.push(FASTLANE)
  return sections.join('\n')
}
