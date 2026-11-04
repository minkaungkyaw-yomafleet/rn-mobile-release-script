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
- [Bun](https://bun.sh) 1.1 or newer. `rnmrs` runs under Bun and tells you if it is missing. Go is **not** needed: the
  package contains the compiled helper binaries.
- Node 18 or newer if you install with npm.
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

## Quick start

Run these in the root of your React Native project:

```bash
rnmrs --init       # asks first, then writes rnmrs.config.yml (never overwrites without an interactive yes)
rnmrs --dry-run    # runs the read-only checks and prints what would run, changing nothing
rnmrs              # the real release, with guided prompts
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
| `-v, --version <x.y.z>` | Exact version. RevoPush needs 2.0.0 or newer. Blank uses the version in the native project. |
| `-d, --description <text>` | Release description. Left out of the command when blank. |
| `-y, --yes` | Answer confirmations with yes. Required for unattended releases. |
| `--no-clean` | Skip cache and build-output cleanup. |
| `--dry-run` | Run the read-only checks and print what would run. Exits 1 if a real run would fail. |
| `--init` | Create `rnmrs.config.yml` after confirmation. |
| `-V, --cli-version` | Print the `rnmrs` version. |

```bash
rnmrs -t revopush -a my-app-android -e Development -d "Hotfix for master branch"
rnmrs -t binary -p ios -e Qa --yes
```

When `-t`, `-e` and either `-a` or `-p` are given, nothing else is prompted (version and description default to blank).

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

`rnmrs --init` writes a commented template. The keys:

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

### Fastlane lanes

With `auto_initialize_commands: true`, `rnmrs` reads each Fastfile and works out the build and release lanes for the
environment from their names (for example `ios_qa_build` and `ios_qa_release`, or `build_qa` and `distribute_qa`). A build
and release pair is preferred over a single lane that does both.

When more than one lane fits, `rnmrs` does not guess. A terminal run asks you to choose, and a CI run fails and names the
candidates. Pin the lanes under `fastlane.lanes.<platform>.<environment>` to make the choice permanent.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `rnmrs needs Bun, which was not found on your PATH` | Install Bun from [bun.sh](https://bun.sh), then run `rnmrs` again. |
| `<file> is missing` or `is empty` | Put the env file for that environment in the project. The release stops on purpose rather than build with the wrong one. |
| `No env_files entry maps to "Production"` | Add `{ path: .env.production, target: production }` to `env_files`. |
| `Several release lanes match ...` | Pin one under `fastlane.lanes` in `rnmrs.config.yml`. |
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
