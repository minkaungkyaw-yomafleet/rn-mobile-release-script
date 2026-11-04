# rn-mobile-release-script (`rnmrs`)

One CLI for React Native releases: Fastlane binary builds and RevoPush OTA updates. It replaces the per-repo
`fastlane:*`, `*RevoPush` and clean scripts in `plus-mobile` and `better-mobile`.

> Full setup, usage and troubleshooting docs live in the separate `rn-mobile-release-script-docs` repository, so they
> are not part of the package developers install. This README is the short reference.

- **Bun** runs the CLI (prompts, config, orchestration).
- **Go** (`native/`, standard library only) does the I/O-heavy work: parallel cleaning, tool probing, Fastfile parsing.
  The two talk over JSON on stdout, and secret values never cross that boundary.

## Setup

```bash
bun install
bun run build:native:current   # builds bin/native/rnmrs-core-<os>-<arch> (needs Go)
bun run check                  # bun tests + go vet + go tests
```

With several Go installs, pick one explicitly: `GO=/opt/homebrew/bin/go bun run build:native:current`.

`bun run build:native` cross-compiles macOS and Linux on arm64 and amd64 and writes `SHA256SUMS`. The binaries are
build artifacts (git-ignored), built by CI and shipped inside the published npm package.

## Installing (for developers who use it)

`rnmrs` is published to the public npm registry. The package already contains the compiled binaries for macOS and Linux
(arm64 and x64), so **Go is not needed**. **Bun 1.1 or newer is** (`rnmrs` runs under Bun); if it is missing, `rnmrs`
says so and where to get it.

```bash
npm install -g rnmrs      # or: bun add -g rnmrs
rnmrs --cli-version
```

To pin the version per project (recommended for teams, since the lockfile keeps everyone on the same one), install it
as a dev dependency and run it through a script:

```bash
npm install -D rnmrs      # then add  "release": "rnmrs"  to the project's package.json scripts
npm run release
```

**Verifying a release.** Every version is built by CI from a `v*` tag. The same tarball is attached to the
GitHub Release for that tag, with a checksum and a cosign signature:

```bash
cosign verify-blob \
  --bundle rnmrs-0.1.0.tgz.sigstore.json \
  --certificate-identity-regexp '^https://github.com/<owner>/rn-mobile-release-script/\.github/workflows/release\.yml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  rnmrs-0.1.0.tgz
```

Replace `<owner>` with the GitHub account that owns the repository. Because the repository is public, npm also records
a provenance attestation for each version; check it with `npm audit signatures`.

## Releasing a new version (maintainers)

1. Bump `version` in `package.json` and merge to `main`.
2. Tag and push: `git tag v0.2.0 && git push origin v0.2.0`.
3. `.github/workflows/release.yml` verifies the tag matches `package.json`, runs `bun audit`, builds all four
   binaries, runs the tests, packs a tarball, signs it with keyless cosign, creates the GitHub Release, and finally
   publishes to npm.

**Publishing to npm is permanent.** npm never lets a version number be reused, and a published version can only be
withdrawn in narrow cases. Check the version and the changelog before you push the tag. Local `npm publish` is blocked
on purpose (`prepublishOnly`); publish only through the workflow.

**One-time setup:**

- An npm account with two-factor authentication, and a repository secret named `NPM_TOKEN` holding an npm access token
  that is allowed to publish `rnmrs`.
- The first publish creates the package. After that, you can switch to npm trusted publishing (package Settings, Trusted
  Publisher, GitHub Actions: this repository and `release.yml`), which needs npm 11.5.1 or newer and Node 22.14 or newer
  in the workflow, and then delete the `NPM_TOKEN` secret so no long-lived token remains.
- Provenance (a signed link from the npm package to the commit and workflow that built it) is added automatically
  because the GitHub repository is public. npm only generates it for public repositories, so the workflow skips it if
  the repository is ever made private again.

`ci.yml` (tests on Linux and macOS, dependency audit) and `codeql.yml` (SAST for JS and Go) run on every PR; Dependabot
keeps the SHA-pinned actions current. CodeQL is free on public repositories (a private one would need GitHub Advanced
Security), and secret scanning is a repository setting to switch on (CI does not scan for secrets).

## Using it in a project

Add `"release": "rnmrs"` to the project's `package.json`, then:

```bash
rnmrs --init     # asks first, then writes rnmrs.config.yml (never overwrites without an interactive yes)
rnmrs            # guided prompts
```

## Flags

| Flag | Meaning |
| --- | --- |
| `-t, --type <revopush\|binary>` | release type |
| `-a, --app <name>` | RevoPush application from the config; also selects the platform |
| `-p, --platform <android\|ios>` | platform when no app is given (needed for `binary` in CI) |
| `-e, --env <environment>` | environment from the config, case-insensitive |
| `-v, --version <x.y.z>` | exact semver; RevoPush needs `>= 2.0.0`; blank uses the native project version |
| `-d, --description <text>` | release description; omitted when blank |
| `-y, --yes` | answer confirmations with yes (required for unattended releases) |
| `--no-clean` | skip cache and build cleanup |
| `--dry-run` | run the read-only checks and print what would run; exits 1 if a real run would fail |

When `-t`, `-e` and (`-a` or `-p`) are all given, nothing else is prompted (version and description default to blank).

```bash
rnmrs -t revopush -a plus-mobile-android -e Development -d "Hotfix for master branch"
rnmrs -t binary -p ios -e Qa --yes
```

## Pipeline

1. **Pre-checks and cleaning**: toolchain probe, package manager (`packageManager` field, then lockfile), the env
   file mapped to the environment must exist and be non-empty, then Metro caches and build output are removed.
2. **Dependencies**: reproducible install only (`bun install --frozen-lockfile`, `yarn install --immutable` on Yarn 2+,
   `--frozen-lockfile` on Yarn 1, `npm ci`); for iOS, `pod install` (via Bundler when there is a Gemfile).
3. **Release**
   - `binary`: Fastlane check (`bundle check`), credential-file check, lane resolution, build lane, then
     `Do you want to proceed with the release? (Y/n)`, then release lane.
   - `revopush`: `revopush whoami`, then
     `revopush release-react <app> <platform> -d <environment> [-t <version>] [--des "<description>"]`.
     Production always asks for confirmation.

Every tool is started from an argv array, never through a shell. The mapped env file is exported as `ENVFILE`.

## Config

See the template written by `rnmrs --init`. Notes:

- `env_files` must have an entry for every environment you release to. A missing mapping stops the release, because a
  build that silently falls back to the wrong `.env` is the failure this tool exists to prevent.
- `fastlane.auto_initialize_commands: true` reads lanes from each Fastfile (and its `import`s). `false` uses only
  the lanes pinned under `fastlane.lanes.<platform>.<environment>.{build,release}`.

### Lane resolution

Lane names differ per repo (`ios_qa_build` / `ios_qa_release` in plus-mobile, `build_qa` / `distribute_qa` in
better-mobile), so lanes are classified from their names: build, release (`distribute`, `release`, `upload`, or a bare
environment name such as `prod`), or both. A build + release pair is preferred over a combined lane.

Some environments are genuinely ambiguous (plus-mobile android production: `android_production_release` vs
`huawei_production_release`; better-mobile ios production: `prod` vs `distribute_prod`). By default nothing is guessed:
an interactive run asks, a CI run fails and tells you to pin the lane. The tie-break rule lives in
`src/fastlane/lanePolicy.js` (`pickLane`) for the team to fill in.

## Development

- `src/` JS (`cli.js`, `config/`, `prompts/`, `fastlane/`, `pipeline/`, `lib/`), `native/` Go, `test/` Bun tests.
- Interactive output uses an in-house spinner (`src/lib/ui.js`): `ora` hangs under Bun 1.4 on a TTY.
- Tests never touch the real system temp directory (`rnmrs-core clean --temp-dir` is injectable).

## Not included yet

- plus-mobile still uses `appcenter codepush` scripts; its RevoPush apps must exist before `-t revopush` works there.
- The Xcode 27 Release-build guard in plus-mobile's `scripts/ios-preflight.sh` is repo-specific and is not ported.
- Binary signing and verification (`SHA256SUMS` is produced; signing belongs in CI).
