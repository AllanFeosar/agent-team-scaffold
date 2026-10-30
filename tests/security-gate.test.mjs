// Behavioural tests for the security gate scripts (assets/security-gate.{sh,ps1}.template). Both implementations
// enforce one rule and are tested against the same scenarios, so they cannot drift apart again: the shell script
// once lacked the "!" test-control lines, the append-only ledger and the "checked N" pass line that the
// PowerShell script had. No network, no tokens.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(HERE, "..", "assets");
const git = (cwd, ...a) => spawnSync("git", a, { cwd, encoding: "utf8" });
const has = (cmd, args = ["--version"]) => { try { return spawnSync(cmd, args, { encoding: "utf8" }).status === 0; } catch { return false; } };

const render = (file) =>
  fs.readFileSync(path.join(ASSETS, file), "utf8").replace(/<test-file regex[^>]*>/, "\\.test\\.").replace(/<security-agent-name>/g, "security");

const PS = process.platform === "win32" ? "powershell.exe" : has("pwsh") ? "pwsh" : null;
const IMPLS = [
  { name: "sh", ext: "sh", ok: has("bash"), cmd: (rel, args) => ["bash", [rel, ...args]] },
  { name: "ps1", ext: "ps1", ok: !!PS, cmd: (rel, args) => [PS, ["-NoProfile", ...(PS === "powershell.exe" ? ["-ExecutionPolicy", "Bypass"] : []), "-File", rel, ...args]] },
];

const LIST = "# sensitive\n^src/auth/\n^src/billing/\n";
const LEDGER = "# Security audit log\n- 2020-01-01 audited src/auth/login.ts and src/billing/pay.ts\n";

function makeRepo(impl, { list = LIST, extra = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atgate-"));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "t");
  git(dir, "config", "core.autocrlf", "false");
  const put = (rel, content) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };
  put(`.claude/hooks/security-gate.${impl.ext}`, render(`security-gate.${impl.ext}.template`));
  put(".claude/security-sensitive-paths.txt", list);
  put(".claude/contracts/security-audit-log.md", LEDGER);
  put("src/auth/login.ts", "a\n");
  put("src/auth/login.test.ts", "t\n");
  put("src/billing/pay.ts", "b\n");
  put("src/other.ts", "o\n");
  for (const [rel, c] of Object.entries(extra)) put(rel, c);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base");
  return { dir, put, stage: () => git(dir, "add", "-A") };
}

function gate(impl, repo, args = ["pre-commit"], { input, env = {} } = {}) {
  const [cmd, argv] = impl.cmd(`.claude/hooks/security-gate.${impl.ext}`, args);
  const r = spawnSync(cmd, argv, { cwd: repo.dir, encoding: "utf8", input, env: { ...process.env, ...env }, timeout: 120000 });
  return { status: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

const appendLedger = (repo, line) => repo.put(".claude/contracts/security-audit-log.md", LEDGER + line + "\n");

for (const impl of IMPLS) {
  const t = (name, fn) => test(`security gate (${impl.name}): ${name}`, { skip: !impl.ok && `${impl.name} interpreter not available` }, fn);

  t("a change touching nothing sensitive passes, and says how many files it checked", () => {
    const r = makeRepo(impl);
    r.put("src/other.ts", "changed\n");
    r.stage();
    const g = gate(impl, r);
    assert.equal(g.status, 0, g.out);
    assert.match(g.out, /checked 1 changed file\(s\) in pre-commit mode/);
  });

  t("a sensitive change with no ledger entry is blocked; naming the file in an added ledger line lets it through", () => {
    const r = makeRepo(impl);
    r.put("src/auth/login.ts", "changed\n");
    r.stage();
    const blocked = gate(impl, r);
    assert.equal(blocked.status, 2, blocked.out);
    assert.match(blocked.out, /src\/auth\/login\.ts/);
    appendLedger(r, "- 2020-02-02 audited src/auth/login.ts: ok");
    r.stage();
    const ok = gate(impl, r);
    assert.equal(ok.status, 0, ok.out);
    assert.match(ok.out, /checked 2 changed file\(s\)/);
  });

  t("the ledger must name the exact path: login.tsx does not satisfy login.ts, and an old entry does not count", () => {
    const r = makeRepo(impl);
    r.put("src/auth/login.ts", "changed\n");
    appendLedger(r, "- 2020-02-02 audited src/auth/login.tsx: ok");
    r.stage();
    const g = gate(impl, r);
    assert.equal(g.status, 2, g.out);
    assert.match(g.out, /aren't named in the lines this change adds/);
  });

  t("the ledger is append-only: editing an existing line is refused even when the new entry is fine", () => {
    const r = makeRepo(impl);
    r.put("src/auth/login.ts", "changed\n");
    r.put(".claude/contracts/security-audit-log.md", "# Security audit log\n- 2020-01-01 audited NOTHING\n- 2020-02-02 audited src/auth/login.ts\n");
    r.stage();
    const g = gate(impl, r);
    assert.equal(g.status, 2, g.out);
    assert.match(g.out, /append-only/);
  });

  t("a test file is exempt unless a '!' line marks it as a security control", () => {
    const r = makeRepo(impl);
    r.put("src/auth/login.test.ts", "changed\n");
    r.stage();
    assert.equal(gate(impl, r).status, 0, "exempt");
    const c = makeRepo(impl, { list: LIST + "!^src/auth/.*\\.test\\.\n" });
    c.put("src/auth/login.test.ts", "changed\n");
    c.stage();
    const g = gate(impl, c);
    assert.equal(g.status, 2, g.out);
    assert.match(g.out, /login\.test\.ts/);
  });

  t("a pattern that matches no tracked file blocks; a '?' pattern may match nothing yet", () => {
    const dead = makeRepo(impl, { list: LIST + "^src/gone/\n" });
    dead.put("src/other.ts", "changed\n");
    dead.stage();
    const g = gate(impl, dead);
    assert.equal(g.status, 2, g.out);
    assert.match(g.out, /match no tracked file.*src\/gone/);
    const planned = makeRepo(impl, { list: LIST + "?^src/gone/\n" });
    planned.put("src/other.ts", "changed\n");
    planned.stage();
    assert.equal(gate(impl, planned).status, 0);
  });

  t("an invalid regex in the new list blocks", () => {
    const r = makeRepo(impl);
    r.put(".claude/security-sensitive-paths.txt", LIST + "(unclosed\n");
    r.put("src/other.ts", "changed\n");
    r.stage();
    const g = gate(impl, r);
    assert.equal(g.status, 2, g.out);
    assert.match(g.out, /invalid pattern/);
  });

  t("a change cannot remove its own coverage: dropping a pattern in the same change still gates the files it covered", () => {
    const r = makeRepo(impl);
    r.put(".claude/security-sensitive-paths.txt", "# sensitive\n^src/billing/\n");
    r.put("src/auth/login.ts", "changed\n");
    appendLedger(r, "- 2020-02-02 audited the list only");
    r.stage();
    const g = gate(impl, r);
    assert.equal(g.status, 2, g.out);
    assert.match(g.out, /src\/auth\/login\.ts/);
  });

  t("range mode: a branch that touches a sensitive file is blocked without a ledger entry and passes with one", () => {
    const r = makeRepo(impl);
    git(r.dir, "checkout", "-q", "-b", "work");
    r.put("src/billing/pay.ts", "changed\n");
    r.stage();
    git(r.dir, "commit", "-q", "-m", "work");
    const blocked = gate(impl, r, ["range", "main", "work"]);
    assert.equal(blocked.status, 2, blocked.out);
    appendLedger(r, "- 2020-02-02 audited src/billing/pay.ts: ok");
    r.stage();
    git(r.dir, "commit", "-q", "-m", "ledger");
    const ok = gate(impl, r, ["range", "main", "work"]);
    assert.equal(ok.status, 0, ok.out);
    assert.match(ok.out, /in range mode/);
  });

  t("range mode without both refs, and an unknown mode, block rather than pass", () => {
    const r = makeRepo(impl);
    assert.equal(gate(impl, r, ["range", "main"]).status, 2);
    assert.equal(gate(impl, r, ["bogus"]).status, 2);
  });
}

// The hook entry point (Claude Code PreToolUse): acts only on `git commit` / `git push`.
for (const impl of IMPLS) {
  const needsJq = impl.name === "sh" && !has("jq");
  test(`security gate (${impl.name}): as a PreToolUse hook it checks git commit but ignores other commands`, { skip: (!impl.ok && "interpreter not available") || (needsJq && "jq not installed") }, () => {
    const r = makeRepo(impl);
    r.put("src/auth/login.ts", "changed\n");
    r.stage();
    const payload = (command) => JSON.stringify({ tool_name: "Bash", tool_input: { command }, cwd: r.dir });
    assert.equal(gate(impl, r, [], { input: payload("ls -la") }).status, 0);
    const commit = gate(impl, r, [], { input: payload('git commit -m "x"') });
    assert.equal(commit.status, 2, commit.out);
    assert.match(commit.out, /src\/auth\/login\.ts/);
  });
}
