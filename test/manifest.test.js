import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import KanbanService from "../index.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

test("package manifest names the plugin and its bundle", () => {
  assert.equal(pkg.name, "better-agentic-kanban");
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.type, "module");
  assert.equal(pkg.license, "MIT");
  assert.equal(pkg.dsh.bundle.patch, "./cordis.patch.yml");
  assert.equal(pkg.dsh.client.platform, "web");
  assert.equal(pkg.engines.dsh, "0.2.2-rc.1");
  assert.ok(pkg.dsh.client.inject.includes("@deepseek-ai/dsh-client-ui-session"));
});

test("every runtime export and packaged asset exists", () => {
  for (const file of ["index.js", "client.js", "cordis.patch.yml", "icon.svg", "locale/en.json"]) {
    assert.ok(existsSync(join(root, file)), `${file} is missing`);
  }
  for (const target of [pkg.exports["."], pkg.exports["./client"], pkg.exports["./icon"]]) {
    assert.ok(existsSync(join(root, target)), `${target} export target is missing`);
  }
  assert.ok(pkg.files.includes("index.js"));
  assert.ok(pkg.files.includes("client.js"));
  assert.ok(pkg.files.includes("cordis.patch.yml"));
  assert.ok(pkg.files.includes("locale/*.json"));
  assert.ok(pkg.files.includes("icon.svg"));
});

test("the Host publishes the expected remote methods", () => {
  const marker = KanbanService.prototype["@deepseek-ai/dsh-typert-protocol/remote-methods"];
  assert.ok(marker, "remote method marker is missing");
  assert.deepEqual(
    marker.methods.map((entry) => entry.method),
    ["list", "add", "move", "deleteTodo"],
  );
});

test("the client bundle and remote descriptors use the package name", () => {
  const client = readFileSync(join(root, "client.js"), "utf8");
  assert.match(client, new RegExp(`id:\\s*"${pkg.name}"`));
  assert.match(client, new RegExp(`package:\\s*"${pkg.name}"`));
  assert.match(client, new RegExp(`"${pkg.name}#kanban/move"`));
});

test("the move session field matches between Host and client", () => {
  // The Gateway reads the Host method's parameter names directly; the client
  // descriptor must send the same wire field or the call is rejected.
  const source = Function.prototype.toString.call(KanbanService.prototype.move);
  const open = source.indexOf("(");
  const close = source.indexOf(")", open + 1);
  const hostFields = source.slice(open + 1, close).split(",").map((part) => part.trim());
  assert.deepEqual(hostFields, ["id", "status", "sessionId"]);

  const client = readFileSync(join(root, "client.js"), "utf8");
  assert.match(client, /name:\s*"sessionId"/);
  assert.match(client, /wire:\s*"sessionId"/);
});

test("display metadata and bundle patch are present", () => {
  const locale = JSON.parse(readFileSync(join(root, "locale/en.json"), "utf8"));
  assert.ok(locale.meta.title.length > 0);
  assert.ok(locale.meta.description.length > 0);
  const patch = readFileSync(join(root, "cordis.patch.yml"), "utf8");
  assert.match(patch, /id: bak/);
  assert.match(patch, new RegExp(`name: '${pkg.name}'`));
});
