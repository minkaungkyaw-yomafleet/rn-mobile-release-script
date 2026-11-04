# Contributing to rnmrs

This is for people changing the code or publishing a release. If you only want to use `rnmrs`, see the
[README](README.md).

## How it is built

`rnmrs` is a Bun program with a small native helper written in Go.

- **Bun CLI** (`src/`): prompts, config, and the order of steps. It starts Fastlane, CocoaPods, the package manager and
  RevoPush.
- **Go core** (`native/`, standard library only): parallel cleaning, tool probing, Fastfile parsing, env checks. One
  static binary per platform.

The two talk over JSON. Each Go command prints one JSON document to stdout and nothing else, or one line to stderr with
exit code 1. Secret values never cross that boundary: the Go result types have no field that could carry one.

| Path | Purpose |
| --- | --- |
| `bin/rnmrs.js` | Entry point. Starts under Node or Bun and hands over to Bun if needed. |
| `src/cli.js` | Flags, config loading, error handling. |
| `src/config/` | Config schema, loader, template, `--init`. |
| `src/prompts/` | Prompts and version rules. |
| `src/fastlane/` | Lane classification and resolution, and the tie-break policy (`lanePolicy.js`). |
| `src/pipeline/` | The three steps: checks, dependencies, release. |
| `src/lib/` | Process execution, the Go bridge, package manager detection, terminal output. |
| `native/` | The Go core and its tests. |
| `test/` | Bun tests. |
| `scripts/build-native.js` | Builds the Go core for each platform and writes `SHA256SUMS`. |

## Set up

You need Bun 1.1 or newer, Go (a current release), and git.

```bash
bun install
bun run build:native:current   # builds bin/native/rnmrs-core-<os>-<arch> for this machine
bun run check                  # Bun tests, go vet, Go tests
```

With several Go installs, pick one: `GO=/opt/homebrew/bin/go bun run build:native:current`. A plain
`go build` inside `native/` leaves a `rnmrs-core` binary there, which is git-ignored.

`bun run build:native` cross-compiles macOS and Linux on arm64 and amd64. The binaries in `bin/native/` are build
artifacts. They are git-ignored, built by CI, and shipped inside the published package.

## Run it from a checkout

```bash
bun bin/rnmrs.js --help
bun bin/rnmrs.js --dry-run -t binary -p android -e Qa     # from inside a project that has an rnmrs.config.yml
```

Use `--dry-run` for experiments. It runs the read-only checks and prints every command instead of running it. To try real
runs without side effects, point `PATH` at stub `fastlane` and `revopush` scripts that only log their arguments.

## Tests

```bash
bun test                        # JavaScript tests
cd native && go vet ./... && go test ./...
```

- Tests must not touch the real system temp folder or the developer's caches. The Go `clean` command takes `--temp-dir`
  so tests can point it at a sandbox.
- The Bun tests in `test/native.test.js` need the Go binary built first (`bun run build:native:current`) and skip with
  a warning if it is missing.
- The lane tests use lane names copied from real Fastfiles, so lane resolution is tested against reality.

## Conventions

- Plain ESM JavaScript, no TypeScript. Match the surrounding code: naming, comment density, idiom.
- Start every process from an argument list (`Bun.spawn([cmd, ...args])`), never through a shell.
- Never print secret values. Report names and counts.
- No hardcoded credentials, and never disable TLS or authentication checks, even "just for testing".
- Do not add `ora`: it hangs under Bun 1.4 on a terminal. The spinner is in `src/lib/ui.js`.
- Add the smallest dependency set you can. Dependencies are audited in CI (`bun audit`).
- If you change the JSON the Go core prints, bump `protocolVersion` in `native/main.go` and `EXPECTED_PROTOCOL` in
  `src/lib/native.js` together, so a stale binary is refused.

### The lane tie-break

When several Fastlane lanes fit the same platform, environment and kind, `pickLane` in `src/fastlane/lanePolicy.js`
decides. It returns `null` by default, which means a terminal run asks and a CI run fails. A confident rule keeps releases
fast, but a wrong pick ships to the wrong store, so any rule you add needs tests in `test/lanes.test.js`.

## Continuous integration

| Workflow | Runs | Does |
| --- | --- | --- |
| `ci.yml` | Pull requests and pushes to `main` | Builds the native binary and runs both test suites on Linux and macOS, and runs `bun audit`. |
| `codeql.yml` | Pull requests, pushes, weekly | Static analysis for JavaScript and Go. Go is built manually, because CodeQL does not support `build-mode: none` for Go. |
| `release.yml` | A pushed `v*` tag | Builds, tests, packs, signs, creates the GitHub Release, publishes to npm. |
| Dependabot | Weekly | Updates the pinned actions and the Go module. |

All actions are pinned to commit SHAs, and each job has only the permissions it needs. Secret scanning is a repository
setting to switch on, and CI does not scan for secrets.

## Releasing (maintainers)

**Publishing to npm is permanent.** npm never lets a version number be reused, and a published version can only be
withdrawn in narrow cases. Check the version before you tag. A local `npm publish` is blocked on purpose
(`prepublishOnly`): publish only through the workflow.

1. Change `version` in `package.json`, run `bun run check`, and merge to `main`.
2. Tag **the commit that contains the new version** and push the tag:

   ```bash
   git tag v0.2.0 <commit-with-that-version>
   git push origin v0.2.0
   ```

   The workflow's first check stops the run if the tag does not match `package.json`, so a tag on the wrong commit fails
   immediately and publishes nothing. Delete it (`git tag -d v0.2.0 && git push origin --delete v0.2.0`) and tag the right
   commit.
3. `release.yml` then checks the tag and the npm version, installs from the lockfile, audits dependencies, builds the four
   binaries, runs the tests, packs one tarball and confirms it contains all four binaries, signs it with keyless cosign,
   creates the GitHub Release (left alone if it already exists), and publishes to npm as the last step.
4. Confirm: `npm view rnmrs@<version> version`. A new version can take a few minutes to appear after the workflow prints
   `+ rnmrs@<version>`.

If a run fails before the publish step, nothing is published and the version number is still free. If it fails at the
publish step, fix the cause and re-run the failed job: the release step skips a release that already exists.

### npm trusted publishing

CI publishes through npm trusted publishing: npm trusts this exact repository and workflow, so there is no stored token and
no 2FA prompt, and npm records provenance automatically. It is already set up for `rnmrs`. To set it up again (for example
after moving the repository), run, as a maintainer logged in to npm:

```bash
npm trust github rnmrs --file release.yml --repo minkaungkyaw-yomafleet/rn-mobile-release-script --allow-publish
npm trust list rnmrs      # check the repository, file and permissions
```

- `--allow-publish` is required. Without it only `npm stage publish` is allowed, and a normal publish from CI is refused.
- The values are case-sensitive and npm does not validate them when saving, so a typo only shows up at the next release.
- The workflow needs npm 11.5.1 or newer (it uses Node 24 and checks early), `id-token: write`, and a GitHub-hosted
  runner. `repository.url` in `package.json` must match the repository exactly. If the repository is renamed or moved to
  another owner, update both the trusted publisher and `repository.url`.
- npm refuses tokens that bypass 2FA for direct publishing, so a long-lived `NPM_TOKEN` will not work.

## Documentation

The full documentation site is a separate repository, `rn-mobile-release-script-docs`, so it is not part of the installed
package. When a release changes behavior or the version, update the matching page and `site.json` there.

## Known gaps

- Lane discovery reads Fastfiles as text, not Ruby. A lane written on one line, or built dynamically, may not be found;
  pin it under `fastlane.lanes`.
- Access checks are practical, not complete: `revopush whoami` for RevoPush, and for Fastlane that the tools run and the
  credential files named in `fastlane/.env` exist.
- Project-specific guards (for example a particular Xcode version check in one app's own preflight script) are not part
  of `rnmrs`.
- Version `0.1.0` was published by hand, so it has no npm provenance. Later versions published by the workflow do.
