import assert from "node:assert/strict";
import test from "node:test";
import KanbanService from "../index.js";

/** Build a service instance without the Cordis constructor. */
function service(ctx = {}) {
  const instance = Object.create(KanbanService.prototype);
  instance.ctx = ctx;
  instance.moves = new Map();
  return instance;
}

test("readMaxParallel reads a volatile reference or a plain number", () => {
  const volatile = service();
  volatile.config = { max_parallel_tasks: { get: () => 3 } };
  assert.equal(volatile.readMaxParallel(), 3);

  const plain = service();
  plain.config = { max_parallel_tasks: 2 };
  assert.equal(plain.readMaxParallel(), 2);

  const missing = service();
  missing.config = {};
  assert.equal(missing.readMaxParallel(), 1);
});

test("setSettings validates the range", async () => {
  const instance = service({ fiber: { entry: {} }, get: () => undefined });

  await assert.rejects(() => instance.setSettings({ maxParallelTasks: 0 }), /between 1 and 10/);
  await assert.rejects(() => instance.setSettings({ maxParallelTasks: 11 }), /between 1 and 10/);
  await assert.rejects(() => instance.setSettings({ maxParallelTasks: 2.5 }), /integer/);
  await assert.rejects(() => instance.setSettings({}), /between 1 and 10/);
});

test("setSettings persists via the config editor", async () => {
  let saved;
  const editor = {
    edit: async (_entry, fn) => {
      saved = fn({});
      return saved;
    },
  };
  const instance = service({
    fiber: { entry: { id: "bak" } },
    get: (name) => (name === "configEditor" ? editor : undefined),
  });

  const result = await instance.setSettings({ maxParallelTasks: 4 });

  assert.deepEqual(result, { maxParallelTasks: 4 });
  assert.equal(saved.max_parallel_tasks, 4);
});

test("setSettings reports when the config editor is unavailable", async () => {
  const instance = service({ fiber: {}, get: () => undefined });

  await assert.rejects(() => instance.setSettings({ maxParallelTasks: 3 }), /cannot be saved/);
});
