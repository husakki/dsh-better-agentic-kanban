import assert from "node:assert/strict";
import test from "node:test";
import KanbanService from "../index.js";

const WORKSPACES = [
  { id: "ws-ibb", path: "/ws/ibb", title: "ibb" },
  { id: "ws-default", path: "/ws/default", title: "Default Workspace" },
];

/** Build a service instance without the Cordis constructor. */
function service(ctx = {}) {
  const instance = Object.create(KanbanService.prototype);
  instance.ctx = ctx;
  instance.moves = new Map();
  return instance;
}

function workspaceRegistry() {
  return {
    list: () => WORKSPACES,
    get: (id) => WORKSPACES.find((ws) => ws.id === id),
  };
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

test("selectWorkspace looks up the workspace by id and activates its path", async () => {
  const instance = service({ workspaceRegistry: workspaceRegistry() });
  const domain = fakeDomain();
  bind(instance, domain);

  const result = await instance.selectWorkspace("ws-ibb");

  assert.equal(result.activeWorkspace, "/ws/ibb");
  assert.equal(domain.global.get().activeWorkspace, "/ws/ibb");
  assert.equal(domain.table("workspaces").get("/ws/ibb").nextNumber, 1);
});

test("selectWorkspace rejects an unknown workspace id", async () => {
  const instance = service({ workspaceRegistry: workspaceRegistry() });
  bind(instance, fakeDomain());

  await assert.rejects(() => instance.selectWorkspace("nope"), /no workspace with id/);
});

test("task numbers increment independently per workspace", async () => {
  const instance = service({ workspaceRegistry: workspaceRegistry() });
  const domain = fakeDomain();
  bind(instance, domain);

  await instance.selectWorkspace("ws-ibb");
  const a = await instance.add({ title: "ibb first" });
  assert.equal(a.number, 1);
  assert.equal(a.workspace, "/ws/ibb");

  await instance.selectWorkspace("ws-default");
  const b = await instance.add({ title: "default first" });
  assert.equal(b.number, 1);
  assert.equal(b.workspace, "/ws/default");

  await instance.selectWorkspace("ws-ibb");
  const c = await instance.add({ title: "ibb second" });
  assert.equal(c.number, 2);
});

test("list reports DSH workspaces by title and filters todos by the active workspace", async () => {
  const domain = fakeDomain(
    [
      { id: "a", number: 1, title: "A", description: "", workspace: "/ws/ibb", status: "todo", createdAt: 1, updatedAt: 1 },
      { id: "b", number: 1, title: "B", description: "", workspace: "/ws/default", status: "todo", createdAt: 2, updatedAt: 2 },
    ],
    { activeWorkspace: "/ws/ibb" },
  );
  const instance = service({ workspaceRegistry: workspaceRegistry() });
  bind(instance, domain);
  instance.config = {};

  const result = await instance.list();

  assert.equal(result.activeWorkspace, "/ws/ibb");
  assert.equal(result.todos.length, 1);
  assert.equal(result.todos[0].id, "a");
  assert.deepEqual(result.workspaces, [
    { id: "ws-ibb", path: "/ws/ibb", title: "ibb" },
    { id: "ws-default", path: "/ws/default", title: "Default Workspace" },
  ]);
  assert.equal(result.maxParallelTasks, 1);
});

test("list returns no todos when no workspace is active", async () => {
  const domain = fakeDomain([], { activeWorkspace: "" });
  const instance = service({ workspaceRegistry: workspaceRegistry() });
  bind(instance, domain);
  instance.config = {};

  const result = await instance.list();

  assert.equal(result.activeWorkspace, null);
  assert.equal(result.todos.length, 0);
});
