import assert from "node:assert/strict";
import test from "node:test";
import KanbanService, { migrateTodos } from "../index.js";

/** Build a service instance without the Cordis constructor. */
function service(ctx = {}) {
  const instance = Object.create(KanbanService.prototype);
  instance.ctx = ctx;
  instance.moves = new Map();
  instance.numberChain = Promise.resolve();
  return instance;
}

/** In-memory fake of an opened domain (single `todos` table + counter global). */
function fakeDomain(rows = []) {
  const records = new Map(rows.map((row) => [row.id, row]));
  let global = { nextNumber: 1 };
  const table = {
    get: (id) => records.get(id),
    put: async (id, value) => {
      records.set(id, value);
    },
    delete: async (id) => {
      records.delete(id);
      return true;
    },
    entries: () => records.entries(),
  };
  return {
    global: {
      get: () => global,
      set: async (value) => {
        global = value;
      },
    },
    table: () => table,
  };
}

function bindAdd(instance, domain) {
  instance.domainPromise = Promise.resolve(domain);
  instance.table = async () => domain.table("todos");
}

test("add assigns monotonic numbers and does not reuse them after deletion", async () => {
  const instance = service();
  bindAdd(instance, fakeDomain());

  const a = await instance.add({ title: "First" });
  const b = await instance.add({ title: "Second", description: "details" });
  assert.equal(a.number, 1);
  assert.equal(b.number, 2);

  await instance.deleteTodo(b.id);
  const c = await instance.add({ title: "Third" });
  assert.equal(c.number, 3);
});

test("add enters the Backlog (todo) status and normalizes the description", async () => {
  const instance = service();
  bindAdd(instance, fakeDomain());

  const noDescription = await instance.add({ title: "No details" });
  assert.equal(noDescription.status, "todo");
  assert.equal(noDescription.description, "");

  const withDescription = await instance.add({ title: "With details", description: "  markdown text  " });
  assert.equal(withDescription.description, "  markdown text  ");
});

test("add rejects an empty or missing title", async () => {
  const instance = service();
  bindAdd(instance, fakeDomain());

  await assert.rejects(() => instance.add({ title: "" }), /non-empty/);
  await assert.rejects(() => instance.add({ title: "   " }), /non-empty/);
  await assert.rejects(() => instance.add({}), /non-empty/);
});

test("update persists title and description and never changes the number", async () => {
  const instance = service();
  bindAdd(instance, fakeDomain());
  const todo = await instance.add({ title: "Old", description: "old desc" });

  const full = await instance.update(todo.id, { title: "New title", description: "new desc" });
  assert.equal(full.title, "New title");
  assert.equal(full.description, "new desc");
  assert.equal(full.number, todo.number);

  const partial = await instance.update(todo.id, { description: "only desc" });
  assert.equal(partial.title, "New title");
  assert.equal(partial.description, "only desc");
  assert.equal(partial.number, todo.number);
});

test("update rejects a missing id and an empty title", async () => {
  const instance = service();
  bindAdd(instance, fakeDomain());
  const todo = await instance.add({ title: "Keep" });

  await assert.rejects(() => instance.update("missing-id", { title: "x" }), /no todo/);
  await assert.rejects(() => instance.update(todo.id, { title: "  " }), /non-empty/);
});

test("moving a task to failed does not wake a session", async () => {
  const calls = [];
  let row = { id: "todo-1", number: 1, title: "Fix it", description: "", status: "todo", createdAt: 1, updatedAt: 1 };
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

test("migrateTodos backfills version-1 rows in creation order and advances the counter", async () => {
  const domain = fakeDomain([
    { id: "a", title: "Later", status: "todo", createdAt: 2, updatedAt: 2 },
    { id: "b", title: "Earlier", status: "done", createdAt: 1, updatedAt: 1 },
  ]);

  await migrateTodos(domain);

  assert.equal(domain.table("todos").get("b").number, 1);
  assert.equal(domain.table("todos").get("a").number, 2);
  assert.equal(domain.table("todos").get("b").description, "");
  assert.equal(domain.global.get().nextNumber, 3);
});

test("migrateTodos keeps existing numbers and never reuses them", async () => {
  const domain = fakeDomain([
    { id: "a", number: 7, title: "Numbered", description: "x", status: "todo", createdAt: 1, updatedAt: 1 },
  ]);

  await migrateTodos(domain);

  assert.equal(domain.table("todos").get("a").number, 7);
  assert.equal(domain.global.get().nextNumber, 8);
});
