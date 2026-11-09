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

test("wakeForTask wakes only the requested root", () => {
  const calls = [];
  const roots = [root("session-a", calls), root("session-b", calls), root("session-c", calls)];
  const instance = service({ agents: { roots: () => roots } });

  const woken = instance.wakeForTask({ id: "todo-1", title: "Fix it" }, "session-b");

  assert.equal(woken, "session-b");
  assert.deepEqual(calls.map((call) => call.id), ["session-b"]);
});

test("wakeForTask falls back to the newest root instead of broadcasting", () => {
  const calls = [];
  const roots = [root("session-a", calls), root("session-b", calls)];
  const instance = service({ agents: { roots: () => roots } });

  assert.equal(instance.wakeForTask({ id: "todo-1", title: "Fix it" }), "session-b");
  assert.deepEqual(calls.map((call) => call.id), ["session-b"]);
});

test("wakeForTask refuses to start when no session exists", () => {
  const instance = service({ agents: { roots: () => [] } });

  assert.throws(
    () => instance.wakeForTask({ id: "todo-1", title: "Fix it" }, "session-a"),
    /no live agent session/,
  );
});

test("the start prompt identifies the durable task", () => {
  const calls = [];
  const instance = service({ agents: { roots: () => [root("session-a", calls)] } });

  instance.wakeForTask({ id: "todo-42", title: "Write the docs" }, "session-a");

  assert.match(calls[0].text, /todo-42/);
  assert.match(calls[0].text, /Write the docs/);
  assert.match(calls[0].text, /kanban_move/);
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
  let row = { id: "todo-1", title: "Fix it", status: "todo", createdAt: 1, updatedAt: 1 };
  const table = {
    get: () => row,
    put: async (_id, value) => {
      row = value;
    },
  };
  const instance = service({
    agents: {
      roots: () => [root("session-a", calls)],
      currentInitiator: () => ({ id: "session-a" }),
    },
  });
  instance.table = async () => table;

  const moved = await instance.applyMove("todo-1", "in_progress", "session-a");

  assert.equal(moved.status, "in_progress");
  assert.deepEqual(calls, []);
});

test("a start with no live session reverts the task to todo", async () => {
  let row = { id: "todo-1", title: "Fix it", status: "todo", createdAt: 1, updatedAt: 1 };
  const table = {
    get: () => row,
    put: async (_id, value) => {
      row = value;
    },
  };
  const instance = service({
    agents: {
      roots: () => [],
      currentInitiator: () => undefined,
    },
  });
  instance.table = async () => table;

  await assert.rejects(
    () => instance.applyMove("todo-1", "in_progress", "session-a"),
    /no live agent session/,
  );
  assert.equal(row.status, "todo");
});
