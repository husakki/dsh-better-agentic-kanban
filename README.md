# better-agentic-kanban (BAK)

A DeepSeek Harness plugin that puts a shared Kanban board in the Web UI: you
write todos, start one, and the agent session you are viewing picks it up and
works through it. The board is the hand-off point between you and the agent.

## Status

Early development (`0.1.x`). The core board, task CRUD, and agent wake-up work.
Workspace binding, Auto mode, concurrency settings, drag-and-drop, per-workspace
numbering, timers, and run summaries are planned but not implemented yet.

## What works now

- Three columns: **Todo**, **In Progress**, **Done**, with counts.
- Add a task from the board; click **Start** to hand it to the agent session you
  are viewing.
- **Done**, **Reopen**, and **Delete** actions on cards.
- Four agent tools: `kanban_list`, `kanban_add`, `kanban_move`, `kanban_remove`.
- A per-task in-flight guard, so a double click or retry cannot start the same
  task twice.
- The agent is told the durable task id, so it can update exactly that card.

> The board is currently global to the plugin profile. Workspace-scoped boards
> and numbering arrive with the workspace story in the roadmap.

## Requirements

- DeepSeek Harness `0.2.2-rc.1` (declared in `engines.dsh`; the `@deepseek-ai/dsh-*`
  packages are pinned to that line).
- Node.js `>= 24.9.0`.
- A Web profile with the plugin installed.

## Install

From this checkout, point the Harness plugin manager at the package directory
(the same flow as **Install from folder** in the Plugin Manager):

```text
plugin_manager install_bundle target=/absolute/path/to/kanban-plugin
```

Once the repository is public, the GitHub package spec can be used with
`install_bundle` instead. Installation selects the bundle and inserts the `bak`
row; no manual profile edits are needed.

After installing, open the **BAK** entry in the sidebar. If the client bundle was
just replaced, refresh the page so the browser loads the new module. A package
rename or dependency change reports `restart-required`: restart DSH before
expecting the new Host row or tools.

## Use

1. Add a task with a short title.
2. Open the session you want to run the task and click **Start** on the card.
   Only that session is woken.
3. Watch the card move to **In Progress**. The agent reads the board, does the
   work, and marks the card **Done** when it finishes. If it cannot finish, it
   leaves the card in progress and reports the blocker.
4. Click **Done** on a completed card to file it, or **Reopen** / **Delete** as
   needed.

## Development

There is no build step. Host code is plain ESM (`index.js`); client code is a
plain browser module (`client.js`). Run the checks before committing:

```bash
CI=1 pnpm install --frozen-lockfile --store-dir .pnpm-store
npm run check
```

## Design notes

- Host state lives in a DSH storage domain (`kanban` / `todos`), not a private
  JSON file.
- The Web client talks to the Host through typed remotes; the descriptors in
  `client.js` must match the service methods in `index.js`.
- A user **Start** resolves the main-view session from the host session list and
  wakes only that root agent. Agent tool calls never wake another agent.
- DSH packages are pinned to the tested Harness release and bumped together.

## Troubleshooting

- **The BAK entry disappeared after updating from `@local/kanban`:** restart DSH
  and look for the panel keyed `bak`. A package rename cannot hot-swap the Host
  row.
- **Install reports `failed to import` with an old version path:** the process
  cached the previous `node_modules/.pnpm` paths. Restart DSH; reinstalling the
  bundle in the same process will not help.
- **Start does nothing:** the board wakes the session you are viewing; open a
  session first, then click Start. If no root is live, the card reverts to Todo
  and the board shows an error.
- **The board looks empty after reinstall:** tasks live in the `kanban` storage
  domain and survive package/version changes; confirm you are on the same DSH
  home.

## License

MIT. See [LICENSE](LICENSE).
