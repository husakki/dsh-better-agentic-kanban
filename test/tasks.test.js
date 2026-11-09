import assert from "node:assert/strict";
import test from "node:test";
import KanbanService, { migrateDomain } from "../index.js";

/** Build a service instance without the Cordis constructor. */
function service(ctx = {}) {
  const instance = Object.create(KanbanService.prototype);
  instance.ctx = ctx;
  instance.moves = new Map();
  return instance;
}

/**
 * In-memory fake of an opened domain: a `todos` table, a `workspaces` table,
 * and the counter/active-workspace global.
 */
function fakeDomain(rows = [], opts = {}) {
  const todos = new Map(rows.map((row) => [row.id, row]));
  const workspaces = new Map(Object.entries(opts.workspaces ?? {}));
  let global = { activeWorkspace: opts.activeWorkspace ?? "" };
  if (opts.nextNumber !== undefined) global.nextNumber = opts.nextNumber;
  const todoTable = {
    get: (id) => todos.get(id),
    put: async (id, value) => {
      todos.set(id, value);
    },
    delete: async (id) => {
      todos.delete(id);
      return true;
    },
    entries: () => todos.entries(),
  };
  const workspaceTable = {
    get: (id) => workspaces.get(id),
    put: async (id, value) => {
      workspaces.set(id, value);
    },
    update: async (id, fn) => {
      const next = fn(workspaces.get(id));
      workspaces.set(id, next);
      return next;
    },
    entries: () => workspaces.entries(),
  };
  return {
    global: {
      get: () => global,
      set: async (value) => {
        global = value;
      },
    },
    table: (name) => (name === "workspaces" ? workspaceTable : todoTable),
  };
}

function bind(instance, domain) {
  instance.domainPromise = Promise.resolve(domain);
  instance.table = async (name = "todos") => domain.table(name);
}

test("add assigns monotonic numbers per workspace and does not reuse after deletion", async () => {
  const instance = service();
  bind(instance, fakeDomain([], { activeWorkspace: "/ws", workspaces: { "/ws": { path: "/ws", nextNumber: 1, addedAt: 1 } } }));

  const a = await instance.add({ title: "First" });
  const b = await instance.add({ title: "Second", description: "details" });
  assert.equal(a.number, 1);
  assert.equal(b.number, 2);
  assert.equal(a.workspace, "/ws");

  await instance.deleteTodo(b.id);
  const c = await instance.add({ title: "Third" });
  assert.equal(c.number, 3);
});

test("add requires an active workspace", async () => {
  const instance = service();
  bind(instance, fakeDomain());

  await assert.rejects(() => instance.add({ title: "No workspace" }), /no workspace is selected/);
});

test("add enters the Backlog (todo) status and normalizes the description", async () => {
  const instance = service();
  bind(instance, fakeDomain([], { activeWorkspace: "/ws", workspaces: { "/ws": { path: "/ws", nextNumber: 1, addedAt: 1 } } }));

  const noDescription = await instance.add({ title: "No details" });
  assert.equal(noDescription.status, "todo");
  assert.equal(noDescription.description, "");

  const withDescription = await instance.add({ title: "With details", description: "  markdown text  " });
  assert.equal(withDescription.description, "  markdown text  ");
});

test("add rejects an empty or missing title", async () => {
  const instance = service();
  bind(instance, fakeDomain([], { activeWorkspace: "/ws", workspaces: { "/ws": { path: "/ws", nextNumber: 1, addedAt: 1 } } }));

  await assert.rejects(() => instance.add({ title: "" }), /non-empty/);
  await assert.rejects(() => instance.add({ title: "   " }), /non-empty/);
  await assert.rejects(() => instance.add({}), /non-empty/);
});

test("update persists title and description and never changes number or workspace", async () => {
  const instance = service();
  bind(instance, fakeDomain([], { activeWorkspace: "/ws", workspaces: { "/ws": { path: "/ws", nextNumber: 1, addedAt: 1 } } }));
  const todo = await instance.add({ title: "Old", description: "old desc" });

  const full = await instance.update(todo.id, { title: "New title", description: "new desc" });
  assert.equal(full.title, "New title");
  assert.equal(full.description, "new desc");
  assert.equal(full.number, todo.number);
  assert.equal(full.workspace, "/ws");

  const partial = await instance.update(todo.id, { description: "only desc" });
  assert.equal(partial.title, "New title");
  assert.equal(partial.description, "only desc");
});

test("update rejects a missing id and an empty title", async () => {
  const instance = service();
  bind(instance, fakeDomain([], { activeWorkspace: "/ws", workspaces: { "/ws": { path: "/ws", nextNumber: 1, addedAt: 1 } } }));
  const todo = await instance.add({ title: "Keep" });

  await assert.rejects(() => instance.update("missing-id", { title: "x" }), /no todo/);
  await assert.rejects(() => instance.update(todo.id, { title: "  " }), /non-empty/);
});

test("moving a task to failed does not wake a session", async () => {
  const calls = [];
  let row = {
    id: "todo-1",
    number: 1,
    title: "Fix it",
    description: "",
    workspace: "/ws",
    status: "todo",
    createdAt: 1,
    updatedAt: 1,
  };
  const table = {
    get: () => row,
    put: async (_id, value) => {
      row = value;
    },
  };
  const root = { id: "session-a", followup: (m) => calls.push(m.content[0].text) };
  const instance = service({
    agents: { roots: () => [root], currentInitiator: () => undefined },
  });
  instance.table = async () => table;

  const moved = await instance.applyMove("todo-1", "failed", "session-a");

  assert.equal(moved.status, "failed");
  assert.deepEqual(calls, []);
});

test("migrateDomain backfills unnumbered v1 rows in creation order and seeds the default workspace", async () => {
  const domain = fakeDomain([
    { id: "a", title: "Later", status: "todo", createdAt: 2, updatedAt: 2 },
    { id: "b", title: "Earlier", status: "done", createdAt: 1, updatedAt: 1 },
  ]);

  await migrateDomain(domain);

  const defaultWorkspace = process.cwd();
  assert.equal(domain.table("todos").get("b").number, 1);
  assert.equal(domain.table("todos").get("a").number, 2);
  assert.equal(domain.table("todos").get("b").description, "");
  assert.equal(domain.table("todos").get("b").workspace, defaultWorkspace);
  assert.equal(domain.global.get().activeWorkspace, defaultWorkspace);
  assert.equal(domain.table("workspaces").get(defaultWorkspace).nextNumber, 3);
});

test("migrateDomain keeps existing numbers, assigns workspaces, and never reuses a number", async () => {
  const domain = fakeDomain(
    [
      { id: "c", number: 7, title: "Numbered", description: "x", status: "todo", createdAt: 3, updatedAt: 3 },
    ],
    { nextNumber: 10 },
  );

  await migrateDomain(domain);

  const defaultWorkspace = process.cwd();
  assert.equal(domain.table("todos").get("c").number, 7);
  assert.equal(domain.table("todos").get("c").workspace, defaultWorkspace);
  assert.equal(domain.global.get().activeWorkspace, defaultWorkspace);
  assert.equal(domain.table("workspaces").get(defaultWorkspace).nextNumber, 10);
});

test("migrateDomain rehomes orphans to the fallback workspace and absorbs the counter", async () => {
  const domain = fakeDomain(
    [
      { id: "a", number: 5, title: "A", description: "", workspace: "/old/path", status: "done", createdAt: 1, updatedAt: 1 },
    ],
    { workspaces: { "/old/path": { path: "/old/path", nextNumber: 9, addedAt: 1 } } },
  );
  const fallback = "/ws/current";

  await migrateDomain(domain, { workspacePaths: new Set(["/ws/current"]), fallback });

  assert.equal(domain.table("todos").get("a").workspace, fallback);
  // Counter absorbs the old workspace counter (9), not just max number + 1 (6).
  assert.equal(domain.table("workspaces").get(fallback).nextNumber, 9);
  assert.equal(domain.global.get().activeWorkspace, fallback);
});
