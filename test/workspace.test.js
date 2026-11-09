import assert from "node:assert/strict";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import KanbanService from "../index.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/** Build a service instance without the Cordis constructor. */
function service(ctx = {}) {
  const instance = Object.create(KanbanService.prototype);
  instance.ctx = ctx;
  instance.moves = new Map();
  return instance;
}

/** In-memory fake domain with `todos` and `workspaces` tables plus the global. */
function fakeDomain(rows = [], opts = {}) {
  const todos = new Map(rows.map((row) => [row.id, row]));
  const workspaces = new Map(Object.entries(opts.workspaces ?? {}));
  let global = { activeWorkspace: opts.activeWorkspace ?? "" };
  return {
    global: {
      get: () => global,
      set: async (value) => {
        global = value;
      },
    },
    table: (name) => {
      const records = name === "workspaces" ? workspaces : todos;
      return {
        get: (id) => records.get(id),
        put: async (id, value) => {
          records.set(id, value);
        },
        update: async (id, fn) => {
          const next = fn(records.get(id));
          records.set(id, next);
          return next;
        },
        delete: async (id) => {
          records.delete(id);
          return true;
        },
        entries: () => records.entries(),
      };
    },
  };
}

function bind(instance, domain) {
  instance.domainPromise = Promise.resolve(domain);
  instance.table = async (name = "todos") => domain.table(name);
}

test("selectWorkspace rejects a missing directory", async () => {
  const instance = service();
  bind(instance, fakeDomain());

  await assert.rejects(() => instance.selectWorkspace(join(root, "does-not-exist-xyz")), /does not exist/);
});

test("selectWorkspace accepts a real directory and activates it", async () => {
  const instance = service();
  const domain = fakeDomain();
  bind(instance, domain);

  const result = await instance.selectWorkspace(root);

  assert.equal(result.activeWorkspace, root);
  assert.equal(domain.global.get().activeWorkspace, root);
  assert.equal(domain.table("workspaces").get(root).nextNumber, 1);
});

test("validateWorkspace reports validity without side effects", async () => {
  const instance = service();
  bind(instance, fakeDomain());

  assert.deepEqual(await instance.validateWorkspace(root), { valid: true, isDirectory: true });
  assert.deepEqual(await instance.validateWorkspace(join(root, "nope")), { valid: false, isDirectory: false });
});

test("task numbers increment independently per workspace", async () => {
  const instance = service();
  const domain = fakeDomain();
  bind(instance, domain);

  await instance.selectWorkspace(root);
  const a = await instance.add({ title: "ws1 first" });
  assert.equal(a.number, 1);
  assert.equal(a.workspace, root);

  const ws2 = join(root, "test");
  await instance.selectWorkspace(ws2);
  const b = await instance.add({ title: "ws2 first" });
  assert.equal(b.number, 1);
  assert.equal(b.workspace, ws2);

  await instance.selectWorkspace(root);
  const c = await instance.add({ title: "ws1 second" });
  assert.equal(c.number, 2);
});

test("list filters todos by the active workspace and reports workspaces", async () => {
  const domain = fakeDomain(
    [
      { id: "a", number: 1, title: "A", description: "", workspace: "/ws1", status: "todo", createdAt: 1, updatedAt: 1 },
      { id: "b", number: 1, title: "B", description: "", workspace: "/ws2", status: "todo", createdAt: 2, updatedAt: 2 },
    ],
    {
      activeWorkspace: "/ws1",
      workspaces: {
        "/ws1": { path: "/ws1", nextNumber: 2, addedAt: 1 },
        "/ws2": { path: "/ws2", nextNumber: 2, addedAt: 2 },
      },
    },
  );
  const instance = service();
  bind(instance, domain);
  instance.config = {};

  const result = await instance.list();

  assert.equal(result.activeWorkspace, "/ws1");
  assert.equal(result.todos.length, 1);
  assert.equal(result.todos[0].id, "a");
  assert.equal(result.workspaces.length, 2);
  assert.equal(result.maxParallelTasks, 1);
});

test("list returns no todos when no workspace is active", async () => {
  const domain = fakeDomain(
    [
      { id: "a", number: 1, title: "A", description: "", workspace: "/ws1", status: "todo", createdAt: 1, updatedAt: 1 },
    ],
    { activeWorkspace: "" },
  );
  const instance = service();
  bind(instance, domain);
  instance.config = {};

  const result = await instance.list();

  assert.equal(result.activeWorkspace, null);
  assert.equal(result.todos.length, 0);
});
