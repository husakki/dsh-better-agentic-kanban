window.__ModuleLoader__.load({
  id: "better-agentic-kanban",
  factory(require) {
    const React = require("react");
    const h = React.createElement;
    const zod = require("zod");

    const NS = "kanban";
    const PANEL_ID = "bak";
    const STATUSES = ["todo", "in_progress", "done", "failed"];

    // ---- Remote contribution (strict descriptors; the Host serves in SRC mode) ----
    function codec(schema) {
      return { mode: "strict", typeSymbol: "@local/kanban", create: () => schema };
    }
    const todoSchema = zod.object({
      id: zod.string(),
      number: zod.number(),
      title: zod.string(),
      description: zod.string(),
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
            {
              name: "request",
              wire: "request",
              source: "json",
              codec: codec(zod.object({ title: zod.string(), description: zod.string().optional() })),
            },
          ],
          result: codec(todoSchema),
        },
        {
          id: "better-agentic-kanban#kanban/update",
          service: "kanban",
          namespace: "kanban",
          method: "update",
          invocation: { kind: "direct" },
          parameters: [
            { name: "id", wire: "id", source: "json", codec: codec(zod.string()) },
            {
              name: "request",
              wire: "request",
              source: "json",
              codec: codec(zod.object({ title: zod.string().optional(), description: zod.string().optional() })),
            },
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
      "col.todo": "Backlog",
      "col.inProgress": "In Progress",
      "col.done": "Done",
      "col.failed": "Failed",
      "add.placeholder": "Write a task for the agent…",
      "add.description.placeholder": "Description (optional, markdown)",
      "add.button": "Add",
      "card.start": "Start",
      "card.reopen": "Reopen",
      "card.done": "Done",
      "card.edit": "Edit",
      "card.delete": "Delete",
      "board.empty": "No tasks yet. Add one above or drag a card here.",
      "edit.title": "Edit task",
      "edit.number": "Task number",
      "edit.title.placeholder": "Task title",
      "edit.description.placeholder": "Description (optional, markdown)",
      "edit.save": "Save",
      "edit.cancel": "Cancel",
      "edit.error.save": "Could not save changes.",
    };

    // ---- Styles (theme tokens only for colors) ----
    const CSS = `
.kanban-plugin-root{display:flex;flex-direction:column;gap:12px;height:100%;padding:16px 20px;box-sizing:border-box;overflow:auto;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
.kanban-plugin-addform{display:flex;flex-direction:column;gap:8px}
.kanban-plugin-addrow{display:flex;gap:8px;align-items:center}
.kanban-plugin-input{flex:1;min-width:0;height:34px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;outline:none}
.kanban-plugin-input:focus{border-color:var(--dsw-alias-brand-primary)}
.kanban-plugin-input::placeholder{color:var(--dsw-alias-label-secondary)}
.kanban-plugin-textarea{width:100%;min-height:52px;padding:8px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;font-family:inherit;resize:vertical;outline:none;box-sizing:border-box}
.kanban-plugin-textarea:focus{border-color:var(--dsw-alias-brand-primary)}
.kanban-plugin-textarea::placeholder{color:var(--dsw-alias-label-secondary)}
.kanban-plugin-btn{height:34px;padding:0 14px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;cursor:pointer}
.kanban-plugin-btn:hover{background:var(--dsw-alias-bg-layer-2)}
.kanban-plugin-btn:disabled{opacity:.5;cursor:default}
.kanban-plugin-btn-primary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#fff}
.kanban-plugin-error{color:var(--dsw-alias-state-error-primary);font-size:12px}
.kanban-plugin-columns{display:grid;grid-template-columns:repeat(4,minmax(180px,1fr));gap:12px;align-items:start}
.kanban-plugin-col{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:8px;min-height:120px;transition:box-shadow .12s ease,border-color .12s ease}
.kanban-plugin-col-dragover{box-shadow:0 0 0 2px var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.kanban-plugin-col-todo{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,var(--dsw-alias-bg-layer-1));border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 32%,var(--dsw-alias-border-l1))}
.kanban-plugin-col-todo .kanban-plugin-col-head{color:var(--dsw-alias-state-business-primary)}
.kanban-plugin-col-in_progress{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 10%,var(--dsw-alias-bg-layer-1));border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 34%,var(--dsw-alias-border-l1))}
.kanban-plugin-col-in_progress .kanban-plugin-col-head{color:var(--dsw-alias-state-warn-primary)}
.kanban-plugin-col-done{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,var(--dsw-alias-bg-layer-1));border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 32%,var(--dsw-alias-border-l1))}
.kanban-plugin-col-done .kanban-plugin-col-head{color:var(--dsw-alias-state-success-primary)}
.kanban-plugin-col-failed{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,var(--dsw-alias-bg-layer-1));border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 32%,var(--dsw-alias-border-l1))}
.kanban-plugin-col-failed .kanban-plugin-col-head{color:var(--dsw-alias-state-error-primary)}
.kanban-plugin-col-head{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);text-transform:uppercase;letter-spacing:.04em;display:flex;justify-content:space-between}
.kanban-plugin-card{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:6px;cursor:grab}
.kanban-plugin-card:active{cursor:grabbing}
.kanban-plugin-card-title{font-size:13px;line-height:18px;word-break:break-word;cursor:pointer;border-radius:4px}
.kanban-plugin-card-title:hover{color:var(--dsw-alias-brand-primary)}
.kanban-plugin-card-number{display:inline-block;margin-right:6px;padding:0 6px;border-radius:6px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);color:var(--dsw-alias-brand-primary);font-size:11px;font-weight:600;line-height:18px;vertical-align:middle}
.kanban-plugin-card-desc{font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary);word-break:break-word;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.kanban-plugin-actions{display:flex;gap:6px;flex-wrap:wrap}
.kanban-plugin-chip{height:24px;padding:0 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font-size:11px;cursor:pointer}
.kanban-plugin-chip:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary)}
.kanban-plugin-chip-danger:hover{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.kanban-plugin-empty{font-size:12px;color:var(--dsw-alias-label-secondary)}
.kanban-plugin-backdrop{position:fixed;inset:0;z-index:1000;background:color-mix(in srgb,var(--dsw-alias-bg-base) 60%,transparent);display:flex;align-items:flex-start;justify-content:center;padding-top:10vh}
.kanban-plugin-modal{width:min(520px,90vw);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;box-shadow:0 12px 40px color-mix(in srgb,#000 24%,transparent);display:flex;flex-direction:column;gap:10px;padding:14px}
.kanban-plugin-modal-head{display:flex;align-items:center;justify-content:space-between}
.kanban-plugin-modal-title{font-size:14px;font-weight:600}
.kanban-plugin-modal-number{font-size:12px;color:var(--dsw-alias-brand-primary);font-weight:600}
.kanban-plugin-modal-actions{display:flex;justify-content:flex-end;gap:8px}
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

    function Card({ todo, onMove, onRemove, onEdit, onDragStart, onDragEnd, t }) {
      const actions = [];
      if (todo.status === "todo") actions.push({ key: "start", label: t("card.start"), to: "in_progress" });
      if (todo.status === "in_progress") actions.push({ key: "done", label: t("card.done"), to: "done" });
      if (todo.status === "done" || todo.status === "failed") {
        actions.push({ key: "reopen", label: t("card.reopen"), to: "todo" });
      }
      return h(
        "div",
        {
          className: "kanban-plugin-card",
          draggable: true,
          onDragStart: (e) => {
            e.dataTransfer.setData("text/plain", todo.id);
            e.dataTransfer.effectAllowed = "move";
            onDragStart(todo.id);
          },
          onDragEnd: () => onDragEnd(),
        },
        h(
          "div",
          {
            className: "kanban-plugin-card-title",
            role: "button",
            tabIndex: 0,
            title: t("card.edit"),
            onClick: () => onEdit(todo.id),
            onKeyDown: (e) => {
              if (e.key === "Enter" || e.key === " ") onEdit(todo.id);
            },
          },
          h("span", { className: "kanban-plugin-card-number" }, `#${todo.number}`),
          todo.title,
        ),
        todo.description
          ? h("div", { className: "kanban-plugin-card-desc" }, todo.description)
          : null,
        h(
          "div",
          { className: "kanban-plugin-actions" },
          actions.map((action) =>
            h(
              "button",
              { key: action.key, className: "kanban-plugin-chip", onClick: () => onMove(todo.id, action.to) },
              action.label,
            ),
          ),
          h(
            "button",
            { className: "kanban-plugin-chip", onClick: () => onEdit(todo.id) },
            t("card.edit"),
          ),
          h(
            "button",
            { className: "kanban-plugin-chip kanban-plugin-chip-danger", onClick: () => onRemove(todo.id) },
            t("card.delete"),
          ),
        ),
      );
    }

    function Column({ status, title, todos, onMove, onRemove, onEdit, onDragStart, onDragEnd, dragOver, onDragOverStatus, onDrop, t }) {
      return h(
        "div",
        {
          className: `kanban-plugin-col kanban-plugin-col-${status}${dragOver === status ? " kanban-plugin-col-dragover" : ""}`,
          onDragOver: (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (dragOver !== status) onDragOverStatus(status);
          },
          onDrop: (e) => {
            e.preventDefault();
            const id = e.dataTransfer.getData("text/plain");
            if (id) onDrop(id, status);
            onDragEnd();
          },
        },
        h(
          "div",
          { className: "kanban-plugin-col-head" },
          title,
          h("span", null, todos.length),
        ),
        todos.length === 0
          ? h("div", { className: "kanban-plugin-empty" }, t("board.empty"))
          : todos.map((todo) =>
              h(Card, { key: todo.id, todo, onMove, onRemove, onEdit, onDragStart, onDragEnd, t }),
            ),
      );
    }

    function EditModal({ todo, onSave, onClose, t }) {
      const [title, setTitle] = React.useState(todo.title);
      const [description, setDescription] = React.useState(todo.description || "");
      const [saving, setSaving] = React.useState(false);
      const [error, setError] = React.useState(null);

      const save = async () => {
        const trimmed = title.trim();
        if (trimmed === "" || saving) return;
        setSaving(true);
        setError(null);
        const ok = await onSave(todo.id, { title: trimmed, description });
        if (!ok) {
          setError(t("edit.error.save"));
          setSaving(false);
        }
      };

      return h(
        "div",
        {
          className: "kanban-plugin-backdrop",
          onClick: () => onClose(),
        },
        h(
          "div",
          {
            className: "kanban-plugin-modal",
            role: "dialog",
            "aria-modal": "true",
            onClick: (e) => e.stopPropagation(),
            onKeyDown: (e) => {
              if (e.key === "Escape") onClose();
            },
          },
          h(
            "div",
            { className: "kanban-plugin-modal-head" },
            h("span", { className: "kanban-plugin-modal-title" }, t("edit.title")),
            h("span", { className: "kanban-plugin-modal-number" }, `${t("edit.number")} #${todo.number}`),
          ),
          h("input", {
            className: "kanban-plugin-input",
            value: title,
            placeholder: t("edit.title.placeholder"),
            autoFocus: true,
            onChange: (e) => setTitle(e.target.value),
            onKeyDown: (e) => {
              if (e.key === "Enter") save();
            },
          }),
          h("textarea", {
            className: "kanban-plugin-textarea",
            rows: 4,
            value: description,
            placeholder: t("edit.description.placeholder"),
            onChange: (e) => setDescription(e.target.value),
          }),
          error ? h("div", { className: "kanban-plugin-error", role: "alert" }, error) : null,
          h(
            "div",
            { className: "kanban-plugin-modal-actions" },
            h(
              "button",
              { className: "kanban-plugin-btn", onClick: () => onClose(), disabled: saving },
              t("edit.cancel"),
            ),
            h(
              "button",
              {
                className: "kanban-plugin-btn kanban-plugin-btn-primary",
                onClick: save,
                disabled: saving || title.trim() === "",
              },
              t("edit.save"),
            ),
          ),
        ),
      );
    }

    function KanbanPage({ kanbanReady, t, useSessions }) {
      const { todos, error, refresh, setError } = useBoard(kanbanReady);
      const [draft, setDraft] = React.useState("");
      const [description, setDescription] = React.useState("");
      const [busy, setBusy] = React.useState(false);
      const [editingId, setEditingId] = React.useState(null);
      const [dragId, setDragId] = React.useState(null);
      const [dragOver, setDragOver] = React.useState(null);
      // The board is root-scoped, so read the main-view session from the host's
      // session list. The Host wakes only this session, never every live root.
      const activeSessionId = useSessions((state) => {
        for (const sessionId of state.ids) {
          if ((state.byId[sessionId]?.retainedBy?.mainView ?? 0) > 0) return sessionId;
        }
        return undefined;
      });

      const editingTodo = editingId === null ? null : (todos || []).find((x) => x.id === editingId) || null;

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
          if (await run((kanban) => kanban.add({ title, description }))) {
            setDraft("");
            setDescription("");
          }
        } finally {
          setBusy(false);
        }
      };

      const move = (id, status) =>
        run((kanban) => kanban.move(id, status, status === "in_progress" ? activeSessionId : undefined));

      const remove = (id) => run((kanban) => kanban.deleteTodo(id));

      const saveEdit = async (id, changes) => {
        const ok = await run((kanban) => kanban.update(id, changes));
        if (ok) setEditingId(null);
        return ok;
      };

      const openEdit = (id) => setEditingId(id);
      const closeEdit = () => setEditingId(null);

      const onDragStart = (id) => setDragId(id);
      const onDragEnd = () => {
        setDragId(null);
        setDragOver(null);
      };
      const onDrop = (id, status) => move(id, status);

      const columns = [
        { status: "todo", title: t("col.todo") },
        { status: "in_progress", title: t("col.inProgress") },
        { status: "done", title: t("col.done") },
        { status: "failed", title: t("col.failed") },
      ];

      return h(
        "div",
        { className: "kanban-plugin-root" },
        h("style", null, CSS),
        h(
          "div",
          { className: "kanban-plugin-addform" },
          h(
            "div",
            { className: "kanban-plugin-addrow" },
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
              {
                className: "kanban-plugin-btn kanban-plugin-btn-primary",
                onClick: add,
                disabled: busy || draft.trim() === "",
              },
              t("add.button"),
            ),
          ),
          h("textarea", {
            className: "kanban-plugin-textarea",
            rows: 2,
            value: description,
            placeholder: t("add.description.placeholder"),
            onChange: (e) => setDescription(e.target.value),
          }),
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
              onEdit: openEdit,
              onDragStart,
              onDragEnd,
              dragOver,
              onDragOverStatus: setDragOver,
              onDrop,
              t,
            }),
          ),
        ),
        editingTodo
          ? h(EditModal, { todo: editingTodo, onSave: saveEdit, onClose: closeEdit, t })
          : null,
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
