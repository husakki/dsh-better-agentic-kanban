# Changelog

All notable changes to better-agentic-kanban are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.1] - 2026-11-09

### Added

- Workspace selection: pick a DeepSeek Harness workspace by name; the board shows
  only that workspace's cards.
- Per-workspace task numbering: counters are independent per workspace and never
  reuse a number after deletion.
- A settings menu with `max_parallel_tasks` (1–10, default 1), persisted to
  plugin configuration and read live by the scheduler.

### Changed

- The workspace selector lists DeepSeek Harness workspaces by title and no
  longer accepts a free-text directory path.
- Storage domain bumped to version 3 with a migration that rehomes pre-existing
  tasks into their containing DeepSeek Harness workspace and preserves counters.

## [0.2.0] - 2026-11-09

### Added

- Per-workspace task numbering (`#1`, `#2`, …) that never reuses a number after
  deletion; the counter persists in the board's storage domain.
- Optional markdown `description` on every task, settable at creation and editable.
- In-place task editing: click a card (or press Edit) to change the title and
  description; `Escape` or clicking outside discards unsaved input.
- Drag-and-drop between columns with hover feedback on the drop target.
- A `Failed` column and status so incomplete or blocked work can be parked and
  reopened.

### Changed

- The board now has four columns: Backlog, In Progress, Done, and Failed.
- Agent tools (`kanban_add`, `kanban_move`, `kanban_list`) expose task numbers,
  descriptions, and the `failed` status.
- Storage domain bumped to version 2 with a migration that backfills numbers and
  descriptions for boards created before `0.2.0`.

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
- Pinned `@deepseek-ai/dsh-*` dependencies to Harness `0.2.2-rc.1` and declared
  the same requirement in `engines.dsh`, so the plugin runs on one Cordis
  generation.

### Fixed

- Starting a todo now wakes exactly one session: the session the user is viewing,
  with the most recently registered root as fallback. The board no longer fans a
  task prompt out to every live root agent.
- Concurrent moves of one task share a single in-flight start, so a double click
  or retry cannot launch duplicate runs.
- Matched the `move` remote field name (`sessionId`) between the Host method
  signature and the client descriptor, so Start no longer fails with an
  unexpected-field Gateway error.
