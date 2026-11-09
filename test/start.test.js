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

function root(id, calls) {
  return {
    id,
    followup(message) {
      calls.push({ id, text: message.content[0].text });
    },
  };
}

test("startTask override follows up the chosen live session", async () => {
  const calls = [];
  const a = root("session-a", calls);
  const b = root("session-b", calls);
  const instance = service({
    agents: {
      roots: () => [a, b],
      get: (id) => [a, b].find((r) => r.id === id),
    },
  });

  const id = await instance.startTask({ id: "todo-1", title: "Fix it" }, "session-a");

  assert.equal(id, "session-a");
  assert.deepEqual(calls.map((call) => call.id), ["session-a"]);
});

test("startTask override rejects an unknown session", async () => {
  const instance = service({
    agents: { roots: () => [], get: () => undefined },
  });

  await assert.rejects(
    () => instance.startTask({ id: "todo-1", title: "Fix it" }, "missing"),
    /no live session/,
  );
});

test("startTask spawns a new session bound to the workspace cwd", async () => {
  const calls = [];
  let createArgs;
  const created = { id: "new-session", followup: (message) => calls.push(message.content[0].text) };
  const instance = service({
    agents: {
      roots: () => [],
      create: async (options) => {
        createArgs = options;
        return { agent: created, dispose: async () => {} };
      },
    },
  });

  const id = await instance.startTask({ id: "todo-2", title: "Write docs", workspace: "/ws/ibb" }, undefined);

  assert.match(id, /^kanban-/);
  assert.equal(id, createArgs.sessionId);
  assert.equal(createArgs.meta.cwd, "/ws/ibb");
  assert.equal(calls.length, 1);
  assert.match(calls[0], /Write docs/);
});

test("startTask spawns without requiring any live roots", async () => {
  const calls = [];
  const instance = service({
    agents: {
      roots: () => [],
      create: async () => ({ agent: { id: "x", followup: (m) => calls.push(m) }, dispose: async () => {} }),
    },
  });

  const id = await instance.startTask({ id: "todo-3", title: "No roots" }, undefined);

  assert.match(id, /^kanban-/);
  assert.equal(calls.length, 1);
});

test("taskMessage identifies the durable task and its number", () => {
  const instance = service();
  const text = instance.taskMessage({ id: "todo-42", number: 9, title: "Write the docs", description: "detail" })
    .content[0].text;

  assert.match(text, /todo-42/);
  assert.match(text, /Write the docs/);
  assert.match(text, /kanban_move/);
  assert.match(text, /#9/);
});

test("concurrent moves of one task share the first operation", async () => {
  const instance = service();
  let applyCalls = 0;
  let finish;
  instance.applyMove = () => {
    applyCalls += 1;
    return new Promise((resolve) => {
      finish = resolve;
    });
  };

  const first = instance.move("todo-1", "in_progress", "session-a");
  const second = instance.move("todo-1", "in_progress", "session-a");
  assert.equal(applyCalls, 1);

  finish("moved");
  assert.equal(await first, "moved");
  assert.equal(await second, "moved");
  assert.equal(instance.moves.size, 0);
});

test("a move started by an agent does not wake another session", async () => {
  const calls = [];
  let row = { id: "todo-1", number: 1, title: "Fix it", description: "", workspace: "/ws", status: "todo", createdAt: 1, updatedAt: 1 };
  const table = {
    get: () => row,
    put: async (_id, value) => {
      row = value;
    },
  };
  const rootAgent = root("session-a", calls);
  const instance = service({
    agents: {
      roots: () => [rootAgent],
      currentInitiator: () => ({ id: "session-a" }),
    },
  });
  instance.table = async () => table;

  const moved = await instance.applyMove("todo-1", "in_progress", "session-a");

  assert.equal(moved.status, "in_progress");
  assert.deepEqual(calls, []);
});

test("a start that fails reverts the task to todo", async () => {
  let row = { id: "todo-1", number: 1, title: "Fix it", description: "", workspace: "/ws", status: "todo", createdAt: 1, updatedAt: 1 };
  const table = {
    get: () => row,
    put: async (_id, value) => {
      row = value;
    },
  };
  const instance = service({
    agents: { roots: () => [], get: () => undefined, currentInitiator: () => undefined },
  });
  instance.table = async () => table;

  await assert.rejects(
    () => instance.applyMove("todo-1", "in_progress", "missing-session"),
    /no live session/,
  );
  assert.equal(row.status, "todo");
});
