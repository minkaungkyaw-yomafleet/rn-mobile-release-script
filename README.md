# rnmrs

Release a React Native app from one command: Fastlane binary builds or RevoPush over-the-air (OTA) updates, with the same
checks and prompts every time. It replaces the long, per-project release scripts.

- **Asks only what it needs.** Release type, platform, application, environment, version and description, with a flag
  for each so it can run unattended.
- **Checks before it changes anything.** Toolchain, package manager, the env file for the chosen environment, and
  Fastlane or RevoPush access.
- **Cleans and installs reproducibly.** Removes Metro caches and build output, installs from the lockfile without
  rewriting it, and runs `pod install` for iOS.
- **Releases with a safety gate.** Binary releases ask before the release step, and Production OTA releases always ask.

## Requirements

- macOS or Linux (arm64 or x64). iOS releases need macOS.
- A JavaScript runtime: [Node](https://nodejs.org) 18 or newer, [Bun](https://bun.sh) or [Deno](https://deno.com) 2. Any
  one is enough. If you have more than one, `rnmrs` uses **Bun first**, then the one it was started with (see
  [Which runtime is used](#which-runtime-is-used)). Go is **not** needed: the package contains the compiled helper
  binaries.
- For the release type you use: Fastlane (or Bundler with a Gemfile), CocoaPods for iOS, or the RevoPush CLI
  (log in with `revopush login`).

## Install

```bash
npm install -g rnmrs      # or: bun add -g rnmrs
rnmrs --cli-version
```

To pin the version per project (recommended for teams, since the lockfile keeps everyone on the same one):

```bash
npm install -D rnmrs      # then add  "release": "rnmrs"  to the project's package.json scripts
npm run release
```

### Which runtime is used

`rnmrs` runs unchanged on Bun, Node and Deno. When you start it, it picks one:

1. **Bun**, if it is installed. It starts fastest.
2. Otherwise the runtime that started it: **Node** when started by npm or Yarn, or **Deno** when started with
   `deno run -A`.

`rnmrs --runtime` prints which one is in use. To force one, set `RNMRS_RUNTIME` to `bun`, `node` or `deno`, for example
`RNMRS_RUNTIME=node rnmrs`. If the runtime you ask for is not installed, `rnmrs` says so instead of falling back.

## Quick start

Run these in the root of your React Native project:

```bash
rnmrs --init       # asks what you release with, then writes rnmrs.config.yml
rnmrs --dry-run    # runs the read-only checks and prints what would run, changing nothing
rnmrs              # the real release, with guided prompts
```

`--init` asks **what you release with**: Fastlane (native app builds), RevoPush (over-the-air updates), or both. Press
Space to tick a box and Enter to confirm. It pre-ticks what it finds in your project, and writes only the sections you
chose. It never overwrites an existing file without an interactive yes. To skip the question, for example in a script:

```bash
rnmrs --init --yes --with revopush           # or: --with fastlane   or: --with fastlane,revopush
```

Review the generated `rnmrs.config.yml` before the first release (see [Configuration](#configuration)).

## Usage

### Flags

Every prompt has a flag, and an answer you pass is not asked again.

| Flag | Meaning |
| --- | --- |
| `-t, --type <revopush\|binary>` | Release type. |
| `-a, --app <name>` | RevoPush application from the config. Also selects the platform. |
| `-p, --platform <android\|ios>` | Platform, when no application is given. Needed for unattended `binary` releases. |
| `-e, --env <environment>` | Environment from the config. Matching ignores case. |
| `-v, --version <x.y.z>` | Release version, exact `x.y.z` with no minimum (`0.1.0` is fine). For RevoPush it is passed as `-t`. Blank uses the version in the native project. |
| `-d, --description <text>` | Release description. Left out of the command when blank. |
| `-y, --yes` | Answer confirmations with yes. Required for unattended releases. |
| `--no-clean` | Skip cache and build-output cleanup. |
| `--dry-run` | Run the read-only checks and print what would run. Exits 1 if a real run would fail. |
| `--init` | Create `rnmrs.config.yml` after confirmation. It asks what you release with. |
| `--with <tools>` | With `--init`: the tools to configure (`fastlane`, `revopush`, or both separated by a comma), instead of asking. |
| `--generate` | Add shortcut commands built from the apps and environments in your config. |
| `--commands` | List the shortcut commands in the config. |
| `<command>` | Run a shortcut command, for example `rnmrs revo_android_development`. See below. |
| `-V, --cli-version` | Print the `rnmrs` version. |
| `--runtime` | Print which JavaScript runtime `rnmrs` is running on (`bun`, `node` or `deno`). |

```bash
rnmrs -t revopush -a my-app-android -e Development -d "Hotfix for master branch"
rnmrs -t binary -p ios -e Qa --yes
```

When `-t`, `-e` and either `-a` or `-p` are given, nothing else is prompted (version and description default to blank).

### Shortcut commands

For a release you do often, `rnmrs --generate` builds one-word commands from the apps and environments already in your
config:

```bash
rnmrs --generate                    # shows what it will add, then asks
rnmrs --commands                    # lists them
rnmrs revo_android_development      # RevoPush, the android app, the Development environment
```

Names are small letters and underscores: `revo_<platform>_<environment>` for RevoPush and
`fastlane_<platform>_<environment>` for Fastlane (with several RevoPush apps on one platform, the app name replaces the
platform). A command fixes the release type, the application or platform, and the environment, so you are only asked for
the **release version** and the **release description**, and both are optional (Enter skips, or pass `-v` and `-d`). With
no terminal nothing is asked. Passing `-t`, `-a`, `-p` or `-e` together with a command is refused, because it would
contradict it.

`--generate` writes the `commands:` section of `rnmrs.config.yml`. It only adds: your comments stay, a command you wrote
is never changed, and one you renamed is not added back under its old name. `--generate --dry-run` lists without writing,
and `--yes` skips the confirmation. Run it again after you add an application or an environment. Each command is one line
you can edit:

```yaml
commands:
  revo_android_development: { type: revopush, app: my-app-android, env: Development }
  fastlane_ios_qa: { type: binary, platform: ios, env: Qa }
  hotfix: { type: revopush, app: my-app-ios, env: Production }   # your own
```

A `revopush` command gives the `app` (which sets the platform). A `binary` command gives the `platform`. `env` is one of
your environments, in any letter case. A mistyped name suggests the nearest one.

### Unattended runs (CI)

Without a terminal, `rnmrs` never waits for input. It fails fast instead: a missing choice stops with the flag to pass,
and a `binary` release or a `Production` RevoPush release needs `--yes`. Pass credentials as environment variables or CI
secrets, never on the command line or in the config.

### What a release does

1. **Pre-checks and cleaning:** looks up the tools, detects the package manager (the `packageManager` field, then the
   lockfile), requires the env file mapped to the environment to exist and not be empty, then removes Metro caches and
   build output.
2. **Dependencies:** a reproducible install (`bun install --frozen-lockfile`, `yarn install --immutable` on Yarn 2 or
   newer, `--frozen-lockfile` on Yarn 1, `npm ci`), then `pod install` for iOS.
3. **Release:**
   - `binary`: checks Fastlane and its credential files, picks the build and release lanes, runs the build, asks
     `Do you want to proceed with the release? (Y/n)`, then runs the release lane.
   - `revopush`: checks `revopush whoami`, then runs
     `revopush release-react <app> <platform> -d <environment> [-t <version>] [--des "<description>"]`.

## Configuration

`rnmrs --init` writes a commented template with the sections for the tools you chose. A section being present is what
tells `rnmrs` that tool is set up: with only a `revopush` section there is no binary release type to choose, and with only
a `fastlane` section there is no RevoPush one. A config needs at least one of them. The keys, with both:

```yaml
project_name: "My App"

env_files:                       # one entry per environment you release to
  - path: .env.qa
    target: qa
  - path: .env.production
    target: production

revopush:                        # optional; needed for -t revopush
  applications:
    - name: my-app-android       # the application name in RevoPush
      target: android
    - name: my-app-ios
      target: ios
      xcode_targets:             # optional, iOS: the Xcode target that holds the app version
        Development: MyAppDevelopment
        Production: MyApp
  environments: [Development, Qa, Staging, Production]

fastlane:
  ios:     { path: "./ios" }
  android: { path: "./android" }
  auto_initialize_commands: true # read lanes from each Fastfile
  # lanes:                       # optional: pin lanes instead of discovery
  #   android:
  #     production:
  #       build: android_production_build
  #       release: android_production_release
```

- Every environment you release to needs an `env_files` entry. A missing or empty env file stops the release, because
  a build that silently falls back to the wrong `.env` is the failure this tool exists to prevent.
- Keep secrets out of this file. It holds names and paths only and is meant to be committed.

### The iOS version of a RevoPush release

An OTA update is delivered only to installed apps whose version matches the release's version. If you leave the version
blank, `rnmrs` finds it in your Xcode project and passes it to RevoPush explicitly.

An Xcode project can hold several targets with different versions: the app at `1.5.3`, for example, and notification or
widget extensions still at `1.0.0`. RevoPush's own CLI does not know which one is your app, and can pick the wrong one,
which publishes an update for an app version that does not exist. So when the targets disagree and nothing says which one
is the app, `rnmrs` stops and lists them. Fix it either way:

- set `xcode_targets` on the iOS application: for each environment, the Xcode target that holds the app version, or
- pass the version yourself with `-v 1.5.3`.

`xcode_targets` applies to iOS applications only. Android reads `versionName` from `build.gradle`.

### Fastlane lanes

With `auto_initialize_commands: true`, `rnmrs` reads each Fastfile and works out the build and release lanes for the
environment from their names (for example `ios_qa_build` and `ios_qa_release`, or `build_qa` and `distribute_qa`). A build
and release pair is preferred over a single lane that does both.

When more than one lane fits, `rnmrs` does not guess. A terminal run asks you to choose, and a CI run fails and names the
candidates. Pin the lanes under `fastlane.lanes.<platform>.<environment>` to make the choice permanent.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `rnmrs could not find deno on your PATH (RNMRS_RUNTIME=deno)` | You asked for a runtime that is not installed. Install it, or unset `RNMRS_RUNTIME` to use what is available. |
| `<file> is missing` or `is empty` | Put the env file for that environment in the project. The release stops on purpose rather than build with the wrong one. |
| `No env_files entry maps to "Production"` | Add `{ path: .env.production, target: production }` to `env_files`. |
| `This project has no fastlane section` / `no revopush section` | That tool is not in `rnmrs.config.yml`. Add its section, or use the other release type. |
| `Unknown command "x"` | The name is not in `commands:`. `rnmrs --commands` lists them, and a near miss is suggested. |
| `The command x already sets the release type ...` | Remove `-t`, `-a`, `-p` or `-e`: a command already fixes them. |
| `Several release lanes match ...` | Pin one under `fastlane.lanes` in `rnmrs.config.yml`. |
| `The Xcode project has targets with different versions ...` | Set `xcode_targets` on the iOS application, or pass `-v <app version>`. See [the iOS version](#the-ios-version-of-a-revopush-release). |
| `Not logged in to RevoPush` | Run `revopush login`, then retry. |
| `This release needs a confirmation but the session is not interactive` | Add `--yes` if you intend an unattended release. |
| `The native core binary is missing` | Install `rnmrs` from npm. A git checkout does not include the compiled helper. |

For an unexpected error, rerun with `RNMRS_DEBUG=1` to see the stack trace.

## Safety

- Every process starts from an argument list, never through a shell, so a description like `fix"; rm -rf ~` is passed as
  one literal argument.
- The env checks report variable names and counts only. Values are never printed.
- Cleaning only removes a fixed list of build and cache folders, inside the project and the system temp folder, and never
  follows symbolic links.
- Releases never rewrite your lockfile, and outward actions need a confirmation or `--yes`.

## Verify a download

Every version is built by CI from a tag, and the same tarball is attached to that tag's GitHub Release with a checksum
and a cosign signature:

```bash
cosign verify-blob \
  --bundle rnmrs-<version>.tgz.sigstore.json \
  --certificate-identity-regexp '^https://github.com/minkaungkyaw-yomafleet/rn-mobile-release-script/\.github/workflows/release\.yml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  rnmrs-<version>.tgz
```

Versions published from CI also carry an npm provenance attestation: run `npm audit signatures` in a project that
installed `rnmrs`.

## Contributing

To work on `rnmrs` itself, or to publish a release, see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

UNLICENSED. All rights reserved.
