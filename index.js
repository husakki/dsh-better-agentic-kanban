import { randomUUID } from "node:crypto";
import { resolve as resolvePath } from "node:path";
import Schema from "@deepseek-ai/schemastery";
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
  // Optional fields admit pre-workspace (v1/v2) rows; the open-time migration
  // backfills them and every new write sets them explicitly.
  number: zod.number().int().positive().optional(),
  title: zod.string().min(1),
  description: zod.string().optional(),
  workspace: zod.string().optional(),
  status: zod.enum(STATUSES),
  createdAt: zod.number(),
  updatedAt: zod.number(),
});

/** One known workspace: its absolute path plus its monotonic number counter. */
const workspaceSchema = zod.object({
  path: zod.string().min(1),
  nextNumber: zod.number().int().min(1),
  addedAt: zod.number(),
});

/** The board is a single global KV domain persisted by the JSON storage backend. */
const kanbanDomain = defineDomain({
  name: "kanban",
  version: 3,
  // Versions 1 (no numbers/descriptions) and 2 (no workspaces) are admitted and
  // backfilled in `migrateDomain` rather than bricking an existing board.
  compatibleVersions: [1, 2],
  tables: {
    todos: domainTable(todoSchema),
    workspaces: domainTable(workspaceSchema),
  },
  global: {
    schema: zod.object({
      // "" means "no workspace selected"; the global slot cannot store null.
      activeWorkspace: zod.string().optional(),
      // v2 legacy counter, migrated into the default workspace then dropped.
      nextNumber: zod.number().int().min(1).optional(),
    }),
    initial: { activeWorkspace: "" },
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

function normalizeMaxParallel(value) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 10) {
    throw new Error("kanban: maxParallelTasks must be an integer between 1 and 10");
  }
  return value;
}

/**
 * Backfill pre-workspace rows into a DeepSeek Harness workspace, rehome rows
 * whose directory is no longer a registered workspace, seed that workspace's
 * counter, and set it active so an existing board keeps working.
 */
async function migrateDomain(domain, { workspacePaths = new Set(), fallback = resolvePath(process.cwd()) } = {}) {
  const todos = domain.table("todos");
  const workspaces = domain.table("workspaces");
  const global = domain.global;
  const g = global.get();

  // Seed the counter above every number already assigned, including counters
  // of workspaces that are being folded away, so a number is never reused.
  let next = typeof g.nextNumber === "number" ? g.nextNumber : 1;
  for (const [, ws] of workspaces.entries()) {
    if (typeof ws.nextNumber === "number") next = Math.max(next, ws.nextNumber);
  }
  const rows = [...todos.entries()].map(([id, value]) => ({ id, value }));
  for (const { value } of rows) {
    if (typeof value.number === "number") next = Math.max(next, value.number + 1);
  }

  const unnumbered = rows
    .filter(({ value }) => typeof value.number !== "number")
    .sort((a, b) => a.value.createdAt - b.value.createdAt);
  const assigned = new Map();
  for (const { id } of unnumbered) assigned.set(id, next++);

  for (const { id, value } of rows) {
    const number = typeof value.number === "number" ? value.number : assigned.get(id);
    const description = typeof value.description === "string" ? value.description : "";
    const current = typeof value.workspace === "string" && value.workspace.length > 0 ? value.workspace : "";
    const workspace = workspacePaths.has(current) ? current : fallback;
    if (value.number !== number || value.description !== description || value.workspace !== workspace) {
      await todos.put(id, { ...value, number, description, workspace });
    }
  }

  const existing = workspaces.get(fallback);
  if (existing === undefined || existing.nextNumber < next) {
    await workspaces.put(fallback, {
      path: fallback,
      nextNumber: Math.max(existing?.nextNumber ?? 0, next),
      addedAt: existing?.addedAt ?? Date.now(),
    });
  }

  const prior = typeof g.activeWorkspace === "string" ? g.activeWorkspace : "";
  const activeWorkspace = workspacePaths.has(prior) ? prior : fallback;
  if (activeWorkspace !== (g.activeWorkspace ?? "")) {
    await global.set({ activeWorkspace });
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
  static inject = ["storageDomain", "tools", "systemPrompt", "agents", "workspaceRegistry"];

  /**
   * Persistent plugin configuration. Declared as a static field because the
   * loader unwraps a default-exported class and reads `Config`/`inject` off it.
   * The field is volatile so saving a new limit updates in place instead of
   * restarting the plugin; `.simplify()` still persists it.
   */
  static Config = Schema.object({
    max_parallel_tasks: Schema.natural().min(1).max(10).default(1).volatile(),
  });

  constructor(ctx, config = {}) {
    super(ctx, "kanban");
    this.config = config;
    this.domainPromise = this.openAndMigrate();
    this.domain = undefined;
    /** In-flight moves keyed by task id; duplicate clicks share one operation. */
    this.moves = new Map();
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
    const registry = this.ctx.workspaceRegistry;
    const workspaces = registry ? registry.list() : [];
    const workspacePaths = new Set(workspaces.map((workspace) => workspace.path));
    await migrateDomain(domain, { workspacePaths, fallback: this.defaultWorkspacePath() });
    return domain;
  }

  /** Prefer the DSH workspace containing the process cwd; else the first one. */
  defaultWorkspacePath() {
    const registry = this.ctx.workspaceRegistry;
    const list = registry ? registry.list() : [];
    const cwd = resolvePath(process.cwd());
    if (list.length === 0) return cwd;
    const containing = list
      .filter((workspace) => cwd === workspace.path || cwd.startsWith(`${workspace.path}/`))
      .sort((a, b) => b.path.length - a.path.length)[0];
    return (containing ?? list[0]).path;
  }

  async table(name = "todos") {
    if (this.domain === undefined) this.domain = await this.domainPromise;
    return this.domain.table(name);
  }

  async activeWorkspace() {
    const domain = await this.domainPromise;
    const active = domain.global.get().activeWorkspace;
    if (typeof active !== "string" || active.length === 0) {
      throw new Error("kanban: no workspace is selected; select a workspace first");
    }
    return active;
  }

  /** Atomically reserve the next number within one workspace's counter. */
  async nextNumberFor(workspace) {
    const table = await this.table("workspaces");
    const updated = await table.update(workspace, (ws) => ({ ...ws, nextNumber: ws.nextNumber + 1 }));
    return updated.nextNumber - 1;
  }

  readMaxParallel() {
    const raw = this.config?.max_parallel_tasks;
    const value = raw != null && typeof raw.get === "function" ? raw.get() : raw;
    return typeof value === "number" && Number.isFinite(value) ? value : 1;
  }

  // ---- Remote methods (SRC discovery reads their parameter names) ----

  async list() {
    const domain = await this.domainPromise;
    const todosTable = await this.table("todos");
    const active = domain.global.get().activeWorkspace;
    const activeWorkspace = typeof active === "string" && active.length > 0 ? active : null;
    const todos = activeWorkspace === null
      ? []
      : [...todosTable.entries()].map(([, value]) => value).filter((todo) => todo.workspace === activeWorkspace);
    const registry = this.ctx.workspaceRegistry;
    const workspaces = (registry ? registry.list() : []).map((workspace) => ({
      id: workspace.id,
      path: workspace.path,
      title: workspace.title,
    }));
    return {
      todos: sortTodos(todos),
      activeWorkspace,
      workspaces,
      maxParallelTasks: this.readMaxParallel(),
    };
  }

  async add(request) {
    const title = normalizeTitle(request?.title);
    const description = normalizeDescription(request?.description);
    const workspace = await this.activeWorkspace();
    const number = await this.nextNumberFor(workspace);
    const now = Date.now();
    const todo = {
      id: `todo-${randomUUID()}`,
      number,
      title,
      description,
      workspace,
      status: "todo",
      createdAt: now,
      updatedAt: now,
    };
    const table = await this.table("todos");
    await table.put(todo.id, todo);
    return todo;
  }

  async update(id, request) {
    if (typeof id !== "string" || id.length === 0) throw new Error("kanban: id is required");
    const table = await this.table("todos");
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
    const table = await this.table("todos");
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
      (todo.workspace ? ` Workspace: ${todo.workspace}.` : "") +
      ` Read the board with kanban_list, do the work now, then mark this task done ` +
      `with kanban_move (id ${JSON.stringify(todo.id)}, status "done"). ` +
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
    const table = await this.table("todos");
    await table.delete(id);
    return { removed: true };
  }

  async selectWorkspace(id) {
    if (typeof id !== "string" || id.length === 0) throw new Error("kanban: workspace id is required");
    const registry = this.ctx.workspaceRegistry;
    const workspace = registry?.get(id);
    if (workspace === undefined) throw new Error(`kanban: no workspace with id ${JSON.stringify(id)}`);
    const path = workspace.path;
    const table = await this.table("workspaces");
    if (table.get(path) === undefined) {
      await table.put(path, { path, nextNumber: 1, addedAt: Date.now() });
    }
    const domain = await this.domainPromise;
    await domain.global.set({ activeWorkspace: path });
    return { activeWorkspace: path };
  }

  async setSettings(request) {
    const value = normalizeMaxParallel(request?.maxParallelTasks);
    const entry = this.ctx.fiber?.entry;
    const editor = this.ctx.get("configEditor");
    if (entry === undefined || editor === undefined) {
      throw new Error("kanban: settings cannot be saved in this profile");
    }
    await editor.edit(entry, (current) => ({ ...current, max_parallel_tasks: value }));
    return { maxParallelTasks: value };
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
        "Statuses are todo, in_progress, done, and failed. Tasks belong to the active workspace " +
        "selected on the board. Keep the board current so the user can see your process.",
    });

    const todoSchemaSpec = {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string", required: true },
        number: { type: "number", required: true },
        title: { type: "string", required: true },
        description: { type: "string", required: true },
        workspace: { type: "string", required: true },
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
        description: "List every task in the active workspace with its status (todo, in_progress, done, failed).",
        parameters: {},
        output: listOutput(),
        execute: async () => {
          const result = await this.list();
          return { todos: result.todos };
        },
        presentCall: () => ({ card: "generic", title: "List Kanban board", kind: "read" }),
      }),
    );

    ctx.tools.register(
      defineTool({
        name: "kanban_add",
        description: "Add a task to the active workspace on the shared Kanban board.",
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
markRemoteMethods(KanbanService, [
  "list",
  "add",
  "update",
  "move",
  "deleteTodo",
  "selectWorkspace",
  "setSettings",
]);

export { migrateDomain };
export default KanbanService;
