import { randomUUID } from "node:crypto";
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { z as zod } from "zod";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { createUserMessage } from "@deepseek-ai/dsh-llm";

/** Stable descriptor key shared with the Gateway's SRC (source-mode) discovery. */
const REMOTE_METHOD_DESCRIPTOR = "@deepseek-ai/dsh-typert-protocol/remote-methods";

const STATUSES = ["todo", "in_progress", "done", "failed"];

/** Durable todo record, validated on every open and write. */
const todoSchema = zod.object({
  id: zod.string().min(1),
  // `number` and `description` are optional here only so version-1 rows (which
  // predate both fields) still validate; the open-time migration backfills them
  // and every new write sets both explicitly.
  number: zod.number().int().positive().optional(),
  title: zod.string().min(1),
  description: zod.string().optional(),
  status: zod.enum(STATUSES),
  createdAt: zod.number(),
  updatedAt: zod.number(),
});

/** The board is a single global KV domain persisted by the JSON storage backend. */
const kanbanDomain = defineDomain({
  name: "kanban",
  version: 2,
  // Version 1 predates task numbers and descriptions; admit those rows and
  // backfill them in `migrateTodos` rather than bricking an existing board.
  compatibleVersions: [1],
  tables: {
    todos: domainTable(todoSchema),
  },
  global: {
    schema: zod.object({ nextNumber: zod.number().int().min(1) }),
    initial: { nextNumber: 1 },
  },
});

function normalizeTitle(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("kanban: title must be a non-empty string");
  }
  return value.trim();
}

function normalizeDescription(value) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new Error("kanban: description must be a string");
  return value;
}

/** Backfill version-1 rows and keep the monotonic number counter honest. */
async function migrateTodos(domain) {
  const table = domain.table("todos");
  let next = domain.global.get().nextNumber;
  const rows = [...table.entries()].map(([id, value]) => ({ id, value }));
  for (const { value } of rows) {
    if (typeof value.number === "number") next = Math.max(next, value.number + 1);
  }
  const unnumbered = rows
    .filter(({ value }) => typeof value.number !== "number")
    .sort((a, b) => a.value.createdAt - b.value.createdAt);
  for (const { id, value } of unnumbered) {
    await table.put(id, {
      ...value,
      number: next,
      description: typeof value.description === "string" ? value.description : "",
    });
    next += 1;
  }
  if (next !== domain.global.get().nextNumber) {
    await domain.global.set({ nextNumber: next });
  }
}

function sortTodos(todos) {
  return todos.sort((a, b) => a.createdAt - b.createdAt || (a.title < b.title ? -1 : 1));
}

/**
 * Kanban service (`ctx.kanban`). Owns the durable board and exposes it through
 * the Typert Remote boundary (SRC mode — no generated manifest) for the Web UI
 * and through agent tools for the model.
 */
class KanbanService extends TypertRemoteService {
  static inject = ["storageDomain", "tools", "systemPrompt", "agents"];

  constructor(ctx, config = {}) {
    super(ctx, "kanban");
    this.domainPromise = this.openAndMigrate();
    this.domain = undefined;
    /** In-flight moves keyed by task id; duplicate clicks share one operation. */
    this.moves = new Map();
    /** Serializes counter reads so concurrent adds never share a number. */
    this.numberChain = Promise.resolve();
    ctx.effect(
      () => () => {
        this.domainPromise.then((d) => d.close()).catch(() => {});
      },
      "kanban: close domain",
    );
    this.registerTools();
  }

  async openAndMigrate() {
    const domain = await this.ctx.storageDomain.open(kanbanDomain);
    await migrateTodos(domain);
    return domain;
  }

  async table() {
    if (this.domain === undefined) this.domain = await this.domainPromise;
    return this.domain.table("todos");
  }

  /** Reserve the next monotonic task number (serialized to avoid races). */
  nextNumber() {
    const operation = this.numberChain.then(async () => {
      const domain = await this.domainPromise;
      const next = domain.global.get().nextNumber;
      await domain.global.set({ nextNumber: next + 1 });
      return next;
    });
    this.numberChain = operation.then(
      () => {},
      () => {},
    );
    return operation;
  }

  // ---- Remote methods (SRC discovery reads their parameter names) ----

  async list() {
    const table = await this.table();
    const todos = [...table.entries()].map(([, value]) => value);
    return { todos: sortTodos(todos) };
  }

  async add(request) {
    const title = normalizeTitle(request?.title);
    const description = normalizeDescription(request?.description);
    const number = await this.nextNumber();
    const now = Date.now();
    const todo = {
      id: `todo-${randomUUID()}`,
      number,
      title,
      description,
      status: "todo",
      createdAt: now,
      updatedAt: now,
    };
    const table = await this.table();
    await table.put(todo.id, todo);
    return todo;
  }

  async update(id, request) {
    if (typeof id !== "string" || id.length === 0) throw new Error("kanban: id is required");
    const table = await this.table();
    const current = table.get(id);
    if (current === undefined) throw new Error(`kanban: no todo with id ${JSON.stringify(id)}`);
    const title = request?.title !== undefined ? normalizeTitle(request.title) : current.title;
    const description =
      request?.description !== undefined ? normalizeDescription(request.description) : (current.description ?? "");
    const next = { ...current, title, description, updatedAt: Date.now() };
    await table.put(id, next);
    return next;
  }

  async move(id, status, sessionId) {
    if (typeof id !== "string" || id.length === 0) throw new Error("kanban: id is required");
    if (!STATUSES.includes(status)) throw new Error(`kanban: invalid status ${JSON.stringify(status)}`);
    if (sessionId !== undefined && typeof sessionId !== "string") {
      throw new Error("kanban: sessionId must be a string when provided");
    }
    // A repeated click or network retry must not start a second run for one task.
    // Concurrent moves of the same task share the first in-flight operation.
    const inFlight = this.moves.get(id);
    if (inFlight !== undefined) return inFlight;
    const operation = this.applyMove(id, status, sessionId);
    this.moves.set(id, operation);
    try {
      return await operation;
    } finally {
      if (this.moves.get(id) === operation) this.moves.delete(id);
    }
  }

  async applyMove(id, status, sessionId) {
    const table = await this.table();
    const current = table.get(id);
    if (current === undefined) throw new Error(`kanban: no todo with id ${JSON.stringify(id)}`);
    if (current.status === status) return current;
    const next = { ...current, status, updatedAt: Date.now() };
    await table.put(id, next);
    // Only a UI "Start" click (no agent initiator) wakes work; an agent's own
    // kanban_move must not re-wake itself or another agent.
    if (current.status === "todo" && status === "in_progress" && this.ctx.agents.currentInitiator() === undefined) {
      try {
        this.wakeForTask(next, sessionId);
      } catch (error) {
        await table.put(id, current);
        throw error;
      }
    }
    return next;
  }

  /**
   * Wake exactly one root agent when the user moves a task into In Progress.
   * The client sends the session it is viewing; otherwise use the most recent
   * root. Never fan one task prompt out to every live root.
   */
  wakeForTask(todo, sessionId) {
    const roots = this.ctx.agents.roots();
    if (roots.length === 0) {
      throw new Error("kanban: no live agent session is available to start this task; open a session first");
    }
    const requested = sessionId === undefined
      ? undefined
      : roots.find((agent) => agent.id === sessionId);
    const target = requested ?? roots[roots.length - 1];
    const label = todo.number === undefined ? todo.id : `#${todo.number} (${todo.id})`;
    const text =
      `The user started Kanban task ${label} (${JSON.stringify(todo.title)})` +
      (todo.description ? ` — ${todo.description}` : "") +
      ` and selected this session to work on it. Read the board with kanban_list, do the work now, ` +
      `then mark this task done with kanban_move (id ${JSON.stringify(todo.id)}, status "done"). ` +
      `If you cannot finish, leave it in_progress and report the concrete blocker.`;
    const message = createUserMessage({
      content: [{ type: "text", text }],
      source: { kind: "kanban" },
    });
    target.followup(message);
    return target.id;
  }

  async deleteTodo(id) {
    if (typeof id !== "string" || id.length === 0) throw new Error("kanban: id is required");
    const table = await this.table();
    await table.delete(id);
    return { removed: true };
  }

  // ---- Agent tools ----

  registerTools() {
    const ctx = this.ctx;
    ctx.systemPrompt.section({
      name: "tool:kanban",
      order: 2500,
      text:
        "A shared Kanban board of tasks the user assigns to you is available. " +
        "Check it with kanban_list at the start of work and whenever the user asks about progress. " +
        "Use kanban_move to mark a task in_progress when you begin it and done when you finish it; " +
        "use kanban_add to record follow-up tasks and kanban_remove to delete tasks. " +
        "Statuses are todo, in_progress, done, and failed. Keep the board current so the user can see your process.",
    });

    const todoSchemaSpec = {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string", required: true },
        number: { type: "number", required: true },
        title: { type: "string", required: true },
        description: { type: "string", required: true },
        status: { type: "string", required: true, enum: STATUSES },
        createdAt: { type: "number", required: true },
        updatedAt: { type: "number", required: true },
      },
    };

    const todoOutput = () => ({
      schema: todoSchemaSpec,
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
    });

    const listOutput = () => ({
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          todos: { type: "array", required: true, items: todoSchemaSpec },
        },
      },
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
    });

    ctx.tools.register(
      defineTool({
        name: "kanban_list",
        description: "List every task on the shared Kanban board with its status (todo, in_progress, done, failed).",
        parameters: {},
        output: listOutput(),
        execute: async () => this.list(),
        presentCall: () => ({ card: "generic", title: "List Kanban board", kind: "read" }),
      }),
    );

    ctx.tools.register(
      defineTool({
        name: "kanban_add",
        description: "Add a task to the shared Kanban board.",
        parameters: {
          title: { type: "string", required: true, description: "Short task description." },
          description: { type: "string", description: "Optional longer details or markdown." },
        },
        output: todoOutput(),
        execute: async (args) => this.add({ title: args.title, description: args.description }),
        presentCall: (args) => ({ card: "generic", title: "Add Kanban task", kind: "other", rawInput: args.title }),
      }),
    );

    ctx.tools.register(
      defineTool({
        name: "kanban_move",
        description: "Change a Kanban task's status to todo, in_progress, done, or failed.",
        parameters: {
          id: { type: "string", required: true, description: "Task id from kanban_list." },
          status: { type: "string", required: true, enum: STATUSES, description: "New status." },
        },
        output: todoOutput(),
        execute: async (args) => this.move(args.id, args.status),
        presentCall: (args) => ({ card: "generic", title: `Mark Kanban task ${args.status}`, kind: "other", rawInput: args.id }),
      }),
    );

    ctx.tools.register(
      defineTool({
        name: "kanban_remove",
        description: "Delete a task from the shared Kanban board.",
        parameters: {
          id: { type: "string", required: true, description: "Task id from kanban_list." },
        },
        output: {
          schema: {
            type: "object",
            additionalProperties: false,
            properties: { removed: { type: "boolean", required: true } },
          },
          render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
        },
        execute: async (args) => this.deleteTodo(args.id),
        presentCall: (args) => ({ card: "generic", title: "Delete Kanban task", kind: "other", rawInput: args.id }),
      }),
    );
  }
}

/** Publish the Remote method markers the Gateway's SRC discovery reads. */
function markRemoteMethods(cls, methods) {
  Object.defineProperty(cls.prototype, REMOTE_METHOD_DESCRIPTOR, {
    configurable: true,
    value: Object.freeze({
      version: 1,
      methods: Object.freeze(
        methods.map((method) => Object.freeze({ method, invocation: Object.freeze({ kind: "direct" }) })),
      ),
    }),
  });
}
markRemoteMethods(KanbanService, ["list", "add", "update", "move", "deleteTodo"]);

export { migrateTodos };
export default KanbanService;
