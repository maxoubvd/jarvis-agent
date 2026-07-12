# Changelog

All notable changes to Jarvis Agent are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), versioning follows [SemVer](https://semver.org/).

## [Unreleased]

First release candidate (V1.0). No tag/release published yet — see `docs/spec.md` (§9, roadmap) and `docs/audit-2026-07-11.md` (full code audit) for the detailed history of the workstreams.

### Added
Initialisation of the project.

### Fixed


### Known limitations
- Sub-agents / parallel delegation not supported (`WorkflowRunner` remains strictly sequential).
- No monetary cost tracking (only token counting is available).
- Checkpoints use the real Git repository (`git stash`/`git commit`), not a separate "shadow" repo — may add noise to the user's Git history.
- Screenshots/demo videos (`docs/media/`) not yet provided — see the release todo.
