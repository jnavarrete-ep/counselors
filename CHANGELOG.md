# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- `install.sh` now supports `COUNSELORS_VERSION` pinning and performs a more resilient latest-tag lookup (with optional `GITHUB_TOKEN` auth) to avoid transient GitHub API failures.
- Release standalone smoke test now fetches `install.sh` from the release tag and runs it with `COUNSELORS_VERSION`, eliminating `main` drift and reducing flaky retries.

## [0.4.3] - 2026-02-16

### Changed
- Gemini model IDs now use Gemini 3 names (`gemini-3-pro`, `gemini-3-flash`) in adapter config and README group examples.
- Release workflow now calls the binaries workflow directly via `workflow_call` instead of relying on tag-push side effects.

### Fixed
- Release workflow now passes an explicit tag to Homebrew update logic in manual (`workflow_dispatch`) runs.
- Homebrew formula updates now pin the npm tarball SHA256 and replace `sha256 :no_check`, so `brew install` succeeds.
- Release workflow now runs parallel smoke tests for npm, standalone installer, and Homebrew installs, validating `--help` and version output.


## [0.4.2] - 2026-02-16

### Fixed
- Various bug fixes



## [0.4.1] - 2026-02-16

### Fixed
- Various bug fixes



## [0.4.0] - 2026-02-16

### Added
- `cleanup` command to delete run output directories older than a configurable age (defaults to 1 day)
- Tool groups (`groups` config, `counselors groups ...`, and `counselors run --group`)
- `upgrade` command with install-method detection (Homebrew, npm, pnpm, yarn, standalone binary)
- Standalone binary releases and `install.sh` curl installer
- Support running the same tool multiple times by repeating it in `--tools` (e.g. `--tools opus,opus,opus`)

### Changed
- Skill template and docs clarify that output directories are configurable via `defaults.outputDir` and `counselors run -o`
- CI runs Windows unit tests on Node 20, 22, and 24 (matching Ubuntu's Node coverage)

### Fixed
- Windows: fixed `.cmd/.bat` execution via `cross-spawn` (stdout capture, synthetic ENOENT), and hardened PATH injection + env allowlisting


## [0.3.4] - 2026-02-10

### Changed
- Agentic quickstart rewritten so agents don't refuse it as social engineering — user installs the CLI, agent only runs config commands with explicit purposes
- Skill template uses second-precision UNIX timestamps instead of millisecond-precision (macOS `date` doesn't support `%N`)
- README adds example prompts and a slash command example to the quickstart


## [0.3.3] - 2026-02-10

### Changed
- Gemini CLI read-only level upgraded from `bestEffort` to `enforced` (tool restrictions are sufficient)
- Doctor no longer warns on `bestEffort` read-only level — only `none` triggers a warning

### Fixed
- Doctor correctly reports Amp deep mode as `bestEffort` instead of `enforced`


## [0.3.2] - 2026-02-10

### Fixed
- `package.json` bin path and repository URL corrected for npm publishing


## [0.3.1] - 2026-02-10

### Changed
- `agent` command clarifies that `counselors skill` prints a reference template to adapt, not a file to blindly copy

### Fixed
- Skill install path in `agent` command now points to `~/.claude/skills/` instead of `~/.claude/commands/`


## [0.3.0] - 2026-02-10

### Added
- Multi-agent parallel dispatch with configurable adapters (Claude, Codex, Gemini, Amp, Custom)
- Project-level `.counselors.json` configuration with defaults overrides
- Tool management commands: add, remove, test, list, discover
- Doctor command for environment diagnostics
- Context gathering with file discovery and prompt building
- Response synthesis across multiple agent outputs
- Amp deep mode support with separate settings file and read-only safety prompt
- Model selection during `init` with per-adapter `extraFlags`
- Skill template output directory prefixed with timestamp for lexical sorting

### Changed
- Simplified `ToolConfig` — removed model concept, unified flags into `extraFlags`

### Security
- Sanitize tool IDs before use in filenames to prevent path traversal
- Allowlist environment variables passed to child processes
- Use `execFileSync` instead of `execSync` in discovery to prevent shell injection
- Restrict project config to `defaults` only — cannot inject `tools`
- Atomic file writes via temp+rename pattern to prevent partial writes

### Fixed
- SIGINT handler properly terminates active child processes
- Release workflow: build before test so integration tests find `dist/cli.js`
- Release script handles blank changelogs instead of failing
- Release workflow accepts leading `v` in version input


[Unreleased]: https://github.com/aarondfrancis/counselors/compare/v0.4.3...HEAD
[0.3.0]: https://github.com/aarondfrancis/counselors/releases/tag/v0.3.0
[0.3.1]: https://github.com/aarondfrancis/counselors/releases/tag/v0.3.1
[0.3.2]: https://github.com/aarondfrancis/counselors/releases/tag/v0.3.2
[0.3.3]: https://github.com/aarondfrancis/counselors/releases/tag/v0.3.3
[0.3.4]: https://github.com/aarondfrancis/counselors/releases/tag/v0.3.4
[0.4.0]: https://github.com/aarondfrancis/counselors/releases/tag/v0.4.0
[0.4.1]: https://github.com/aarondfrancis/counselors/releases/tag/v0.4.1
[0.4.2]: https://github.com/aarondfrancis/counselors/releases/tag/v0.4.2
[0.4.3]: https://github.com/aarondfrancis/counselors/releases/tag/v0.4.3
