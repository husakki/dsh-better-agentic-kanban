# Changelog

All notable changes to better-agentic-kanban are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-11-09

### Added

- Initial public development version of BAK: board UI, task CRUD, three status
  columns, typed remotes, and the `kanban_*` agent tools.
- README, MIT license, changelog, regression tests, and CI checks.
- Regression tests for start targeting, concurrent-move dedupe, agent-initiated
  moves, and the no-session revert.
- Manifest checks and a GitHub Actions workflow that runs the same `npm run check`
  locally and on pushes to `main`.

### Changed

- Renamed the package from `@local/kanban` to `better-agentic-kanban`; the
  sidebar label is now **BAK** and the panel key is `bak`.
- Pinned `@deepseek-ai/dsh-*` dependencies to Harness `0.2.2-rc.1` so the plugin
  runs on one Cordis generation.

### Fixed

- Starting a todo now wakes exactly one session: the session the user is viewing,
  with the most recently registered root as fallback. The board no longer fans a
  task prompt out to every live root agent.
- Concurrent moves of one task share a single in-flight start, so a double click
  or retry cannot launch duplicate runs.
