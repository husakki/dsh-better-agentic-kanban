window.__ModuleLoader__.load({
  id: "better-agentic-kanban",
  factory(require) {
    const React = require("react");
    const h = React.createElement;
    const zod = require("zod");

    const NS = "kanban";
    const PANEL_ID = "bak";
    const STATUSES = ["todo", "in_progress", "done"];

    // ---- Remote contribution (strict descriptors; the Host serves in SRC mode) ----
    function codec(schema) {
      return { mode: "strict", typeSymbol: "@local/kanban", create: () => schema };
    }
    const todoSchema = zod.object({
      id: zod.string(),
      title: zod.string(),
      status: zod.enum(STATUSES),
      createdAt: zod.number(),
      updatedAt: zod.number(),
    });
    const KANBAN_REMOTE = {
      package: "better-agentic-kanban",
      descriptors: [
        {
          id: "better-agentic-kanban#kanban/list",
          service: "kanban",
          namespace: "kanban",
          method: "list",
          invocation: { kind: "direct" },
          parameters: [],
          result: codec(zod.object({ todos: zod.array(todoSchema) })),
        },
        {
          id: "better-agentic-kanban#kanban/add",
          service: "kanban",
          namespace: "kanban",
          method: "add",
          invocation: { kind: "direct" },
          parameters: [
            { name: "request", wire: "request", source: "json", codec: codec(zod.object({ title: zod.string() })) },
          ],
          result: codec(todoSchema),
        },
        {
          id: "better-agentic-kanban#kanban/move",
          service: "kanban",
          namespace: "kanban",
          method: "move",
          invocation: { kind: "direct" },
          parameters: [
            { name: "id", wire: "id", source: "json", codec: codec(zod.string()) },
            { name: "status", wire: "status", source: "json", codec: codec(zod.enum(STATUSES)) },
            {
              name: "sessionId",
              wire: "sessionId",
              source: "json",
              acceptsUndefined: true,
              codec: codec(zod.string()),
            },
          ],
          result: codec(todoSchema),
        },
        {
          id: "better-agentic-kanban#kanban/deleteTodo",
          service: "kanban",
          namespace: "kanban",
          method: "deleteTodo",
          invocation: { kind: "direct" },
          parameters: [{ name: "id", wire: "id", source: "json", codec: codec(zod.string()) }],
          result: codec(zod.object({ removed: zod.boolean() })),
        },
      ],
    };

    // ---- Locale dictionaries ----
    const en = {
      panel: "BAK",
      "col.todo": "Todo",
      "col.inProgress": "In Progress",
      "col.done": "Done",
      "add.placeholder": "Write a task for the agent…",
      "add.button": "Add",
      "card.start": "Start",
      "card.reopen": "Reopen",
      "card.done": "Done",
      "card.delete": "Delete",
      "board.empty": "No tasks yet. Add one above.",
    };

    // ---- Styles (theme tokens only for colors) ----
    const CSS = `
.kanban-plugin-root{display:flex;flex-direction:column;gap:12px;height:100%;padding:16px 20px;box-sizing:border-box;overflow:auto;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
.kanban-plugin-addbar{display:flex;gap:8px;align-items:center}
.kanban-plugin-input{flex:1;min-width:0;height:34px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;outline:none}
.kanban-plugin-input:focus{border-color:var(--dsw-alias-brand-primary)}
.kanban-plugin-input::placeholder{color:var(--dsw-alias-label-secondary)}
.kanban-plugin-btn{height:34px;padding:0 14px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;cursor:pointer}
.kanban-plugin-btn:hover{background:var(--dsw-alias-bg-layer-2)}
.kanban-plugin-btn:disabled{opacity:.5;cursor:default}
.kanban-plugin-btn-primary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#fff}
.kanban-plugin-error{color:var(--dsw-alias-state-error-primary);font-size:12px}
.kanban-plugin-columns{display:grid;grid-template-columns:repeat(3,minmax(200px,1fr));gap:12px;align-items:start}
.kanban-plugin-col{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:8px;min-height:120px}
.kanban-plugin-col-todo{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,var(--dsw-alias-bg-layer-1));border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 32%,var(--dsw-alias-border-l1))}
.kanban-plugin-col-todo .kanban-plugin-col-head{color:var(--dsw-alias-state-business-primary)}
.kanban-plugin-col-in_progress{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 10%,var(--dsw-alias-bg-layer-1));border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 34%,var(--dsw-alias-border-l1))}
.kanban-plugin-col-in_progress .kanban-plugin-col-head{color:var(--dsw-alias-state-warn-primary)}
.kanban-plugin-col-done{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,var(--dsw-alias-bg-layer-1));border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 32%,var(--dsw-alias-border-l1))}
.kanban-plugin-col-done .kanban-plugin-col-head{color:var(--dsw-alias-state-success-primary)}
.kanban-plugin-col-head{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);text-transform:uppercase;letter-spacing:.04em;display:flex;justify-content:space-between}
.kanban-plugin-card{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:8px}
.kanban-plugin-card-title{font-size:13px;line-height:18px;word-break:break-word}
.kanban-plugin-actions{display:flex;gap:6px;flex-wrap:wrap}
.kanban-plugin-chip{height:24px;padding:0 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font-size:11px;cursor:pointer}
.kanban-plugin-chip:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary)}
.kanban-plugin-chip-danger:hover{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.kanban-plugin-empty{font-size:12px;color:var(--dsw-alias-label-secondary)}
`;

    function useBoard(kanbanReady) {
      const [todos, setTodos] = React.useState(null);
      const [error, setError] = React.useState(null);
      const refresh = React.useCallback(async () => {
        try {
          const kanban = await kanbanReady;
          const res = await kanban.list();
          if (res && res.ok) {
            setError(null);
            setTodos(res.value.todos);
          } else {
            setError((res && res.error && res.error.message) || "list failed");
          }
        } catch (e) {
          setError(e && e.message ? e.message : String(e));
        }
      }, [kanbanReady]);
      React.useEffect(() => {
        refresh();
      }, [refresh]);
      return { todos, error, refresh, setError };
    }

    function Card({ todo, onMove, onRemove, t }) {
      const start = todo.status === "todo";
      const done = todo.status !== "done";
      const reopen = todo.status === "done";
      return h(
        "div",
        { className: "kanban-plugin-card" },
        h("div", { className: "kanban-plugin-card-title" }, todo.title),
        h(
          "div",
          { className: "kanban-plugin-actions" },
          start
            ? h("button", { className: "kanban-plugin-chip", onClick: () => onMove(todo.id, "in_progress") }, t("card.start"))
            : null,
          done && !reopen
            ? h("button", { className: "kanban-plugin-chip", onClick: () => onMove(todo.id, "done") }, t("card.done"))
            : null,
          reopen
            ? h("button", { className: "kanban-plugin-chip", onClick: () => onMove(todo.id, "todo") }, t("card.reopen"))
            : null,
          h("button", { className: "kanban-plugin-chip kanban-plugin-chip-danger", onClick: () => onRemove(todo.id) }, t("card.delete")),
        ),
      );
    }

    function Column({ status, title, todos, onMove, onRemove, t }) {
      return h(
        "div",
        { className: `kanban-plugin-col kanban-plugin-col-${status}` },
        h(
          "div",
          { className: "kanban-plugin-col-head" },
          title,
          h("span", null, todos.length),
        ),
        todos.length === 0
          ? h("div", { className: "kanban-plugin-empty" }, t("board.empty"))
          : todos.map((todo) => h(Card, { key: todo.id, todo, onMove, onRemove, t })),
      );
    }

    function KanbanPage({ kanbanReady, t, useSessions }) {
      const { todos, error, refresh, setError } = useBoard(kanbanReady);
      const [draft, setDraft] = React.useState("");
      const [busy, setBusy] = React.useState(false);
      // The board is root-scoped, so read the main-view session from the host's
      // session list. The Host wakes only this session, never every live root.
      const activeSessionId = useSessions((state) => {
        for (const sessionId of state.ids) {
          if ((state.byId[sessionId]?.retainedBy?.mainView ?? 0) > 0) return sessionId;
        }
        return undefined;
      });

      const run = async (action) => {
        try {
          const kanban = await kanbanReady;
          const res = await action(kanban);
          if (res && res.ok) {
            await refresh();
            return true;
          }
          setError((res && res.error && res.error.message) || "operation failed");
          return false;
        } catch (e) {
          setError(e && e.message ? e.message : String(e));
          return false;
        }
      };

      const add = async () => {
        const title = draft.trim();
        if (!title || busy) return;
        setBusy(true);
        try {
          if (await run((kanban) => kanban.add({ title }))) setDraft("");
        } finally {
          setBusy(false);
        }
      };

      const move = (id, status) =>
        run((kanban) => kanban.move(id, status, status === "in_progress" ? activeSessionId : undefined));

      const remove = (id) => run((kanban) => kanban.deleteTodo(id));

      const columns = [
        { status: "todo", title: t("col.todo") },
        { status: "in_progress", title: t("col.inProgress") },
        { status: "done", title: t("col.done") },
      ];

      return h(
        "div",
        { className: "kanban-plugin-root" },
        h("style", null, CSS),
        h(
          "div",
          { className: "kanban-plugin-addbar" },
          h("input", {
            className: "kanban-plugin-input",
            value: draft,
            placeholder: t("add.placeholder"),
            onChange: (e) => setDraft(e.target.value),
            onKeyDown: (e) => {
              if (e.key === "Enter") add();
            },
          }),
          h(
            "button",
            { className: "kanban-plugin-btn kanban-plugin-btn-primary", onClick: add, disabled: busy || draft.trim() === "" },
            t("add.button"),
          ),
        ),
        error ? h("div", { className: "kanban-plugin-error", role: "alert" }, error) : null,
        h(
          "div",
          { className: "kanban-plugin-columns" },
          columns.map((col) =>
            h(Column, {
              key: col.status,
              status: col.status,
              title: col.title,
              todos: (todos || []).filter((x) => x.status === col.status),
              onMove: move,
              onRemove: remove,
              t,
            }),
          ),
        ),
      );
    }

    function KanbanIcon({ size = 20 }) {
      return h(
        "svg",
        { viewBox: "0 0 24 24", width: size, height: size, "aria-hidden": true, fill: "none" },
        h("rect", { x: 3, y: 4, width: 5.2, height: 16, rx: 1.2, stroke: "currentColor", strokeWidth: 1.6 }),
        h("rect", { x: 9.4, y: 4, width: 5.2, height: 16, rx: 1.2, stroke: "currentColor", strokeWidth: 1.6 }),
        h("rect", { x: 15.8, y: 4, width: 5.2, height: 16, rx: 1.2, stroke: "currentColor", strokeWidth: 1.6 }),
        h("rect", { x: 4.1, y: 7.5, width: 3, height: 3, rx: 0.8, fill: "currentColor" }),
        h("rect", { x: 10.5, y: 12, width: 3, height: 3, rx: 0.8, fill: "currentColor" }),
        h("rect", { x: 16.9, y: 9, width: 3, height: 3, rx: 0.8, fill: "currentColor" }),
      );
    }

    const inject = ["slots", "remote", "locale"];

    function apply(ctx) {
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.locale.register(NS, { en }), "kanban: locale");

      // Mount the Remote namespace once; the component awaits this promise.
      let settleReady;
      const kanbanReady = new Promise((resolve, reject) => {
        settleReady = (error) => (error ? reject(error) : resolve(ctx.get("remote.kanban")));
      });
      ctx.effect(() => {
        let dispose;
        ctx.remote
          .$mount(KANBAN_REMOTE)
          .then((d) => {
            dispose = d;
            settleReady();
          })
          .catch((error) => {
            settleReady(error instanceof Error ? error : new Error(String(error)));
          });
        return () => {
          dispose?.();
        };
      }, "kanban: remote mount");

      ctx.slots.inject("main", () =>
        ctx.slots.register(
          {
            name: "main",
            key: PANEL_ID,
            locale: NS,
            inject: () => ({ kanbanReady }),
          },
          KanbanPage,
        ),
      );

      ctx.slots.inject("sidebar.panellist", () =>
        ctx.slots.register(
          {
            name: "sidebar.panellist",
            id: PANEL_ID,
            order: 10,
            locale: NS,
            label: () => t("panel"),
          },
          KanbanIcon,
        ),
      );
    }

    return { inject, apply };
  },
});
