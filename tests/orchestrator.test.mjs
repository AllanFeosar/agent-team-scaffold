// Behavioural tests for assets/orchestrator.mjs.template, driven through its real CLI against a
// throwaway git repo and a deterministic fake provider (tests/fake-provider.mjs). No network, no
// tokens. Run: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const TEMPLATE = path.join(REPO, "assets", "orchestrator.mjs.template");
const FAKE = path.join(HERE, "fake-provider.mjs");

const PLAYBOOK = `# Worker — Playbook

## Purpose
Test fixture.

## Definition of done
| # | Check | Evidence | How to run | Enforced by |
|---|-------|----------|------------|-------------|
| 1 | Self-verification passes | exit code 0 | \`true\` | gate |

## Edge cases
- none
`;

const AGENT_MD = `---
name: worker
description: >
  Fixture agent. Invoke for: work. Do NOT invoke for: anything else.
model: sonnet
tools:
  - Read
  - Edit
skills:
  - some-skill
---

You are the worker.
`;

function git(dir, ...args) {
  return execFileSync("git", args, { cwd: dir, stdio: "pipe", encoding: "utf8" });
}

function makeProject({ agent = {}, roster = {}, provider = {}, files = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atscaf-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "atscaf-home-"));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "t");
  git(dir, "config", "core.autocrlf", "false");
  const put = (rel, content) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };
  put(".gitignore", ".agent-team/worktrees/\n.agent-team/events.jsonl\n.agent-team/STOP\n");
  fs.copyFileSync(FAKE, path.join(dir, "fake.mjs"));
  fs.mkdirSync(path.join(dir, ".agent-team"), { recursive: true });
  fs.copyFileSync(TEMPLATE, path.join(dir, ".agent-team", "orchestrator.mjs"));
  put(
    ".agent-team/providers.json",
    JSON.stringify({
      fake: { command: "node", args: ["fake.mjs"], adviceArgs: ["fake.mjs", "--advice"], modelFlag: "--model", budgetFlag: "--budget", usageLimitPatterns: ["USAGE-LIMIT"], ...provider },
      noadvice: { command: "node", args: ["fake.mjs"] },
    }),
  );
  put(
    ".agent-team/roster.json",
    JSON.stringify({
      agents: [{ name: "worker", provider: "fake", ownership: ["src/**", "tests/**", "features.json"], selfVerification: "true", routing: ["work"], worktree: true, ...agent }],
      ...roster,
    }),
  );
  put(".agent-team/tentacles/worker/CONTEXT.md", "# Worker\n\nFixture.\n");
  put(".agent-team/tentacles/worker/PLAYBOOK.md", PLAYBOOK);
  put(".claude/agents/worker.md", AGENT_MD);
  put(".agent-team/STATUS.md", "# Status\n\n## Queue\n- [ ] [worker] DO:WRITE:src/out.txt=hello\n");
  for (const [rel, content] of Object.entries(files)) put(rel, content);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "init");
  return { dir, home, argvLog: path.join(home, "argv.log") };
}

function run(proj, args, { env = {}, input } = {}) {
  const r = spawnSync("node", [path.join(proj.dir, ".agent-team", "orchestrator.mjs"), ...args], {
    cwd: proj.dir,
    encoding: "utf8",
    input,
    env: { ...process.env, HOME: proj.home, USERPROFILE: proj.home, FAKE_ARGV_LOG: proj.argvLog, ...env },
    timeout: 60000,
  });
  return { status: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

const seal = (proj) => run(proj, ["seal"], { env: { AGENT_TEAM_ALLOW_NONINTERACTIVE_SEAL: "1" } });
const events = (proj) => {
  const p = path.join(proj.dir, ".agent-team", "events.jsonl");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const has = (proj, type) => events(proj).some((e) => e.type === type);

// ---------------------------------------------------------------------------------------------

test("happy path: worker's uncommitted edits are committed and merged (regression: work used to be dropped)", () => {
  const p = makeProject();
  seal(p);
  const r = run(p, ["spawn", "worker", "DO:WRITE:src/out.txt=hello"]);
  assert.match(r.out, /worker done in 1 attempt/);
  assert.equal(fs.readFileSync(path.join(p.dir, "src", "out.txt"), "utf8"), "hello");
  assert.match(git(p.dir, "log", "--oneline", "-3"), /team\(worker\)/);
  for (const t of ["dispatch_start", "attempt", "self_verification", "committed", "merge"]) assert.ok(has(p, t), `missing event ${t}`);
});

test("event log records sizes and verdicts but never prompt or output text", () => {
  const p = makeProject();
  run(p, ["spawn", "worker", "DO:WRITE:src/secret.txt=SUPERSECRETVALUE"]);
  const raw = fs.readFileSync(path.join(p.dir, ".agent-team", "events.jsonl"), "utf8");
  assert.ok(!raw.includes("SUPERSECRETVALUE"));
  assert.ok(!raw.includes("fake - evidence"));
});

test("seal refuses without a TTY and without the CI override", () => {
  const p = makeProject();
  const r = run(p, ["seal"]);
  assert.equal(r.status, 1);
  assert.match(r.out, /seal refused/);
  assert.ok(!fs.existsSync(path.join(p.dir, ".agent-team", "integrity.json")));
});

test("integrity: ok when sealed, fails when the gate config is edited, and dispatch refuses to run", () => {
  const p = makeProject();
  seal(p);
  assert.equal(run(p, ["integrity"]).status, 0);
  const rosterPath = path.join(p.dir, ".agent-team", "roster.json");
  const roster = JSON.parse(fs.readFileSync(rosterPath, "utf8"));
  roster.agents[0].selfVerification = "echo pwned";
  fs.writeFileSync(rosterPath, JSON.stringify(roster));
  const i = run(p, ["integrity"]);
  assert.equal(i.status, 1);
  assert.match(i.out, /changed: \.agent-team\/roster\.json/);
  const s = run(p, ["spawn", "worker", "DO:WRITE:src/x.txt=1"]);
  assert.match(s.out, /protected files differ from the sealed manifest/);
  assert.ok(!has(p, "dispatch_start"));
});

test("integrity: a new hook script, and a rewritten integrity.json, are both detected", () => {
  const p = makeProject();
  seal(p);
  fs.mkdirSync(path.join(p.dir, ".claude", "hooks"), { recursive: true });
  fs.writeFileSync(path.join(p.dir, ".claude", "hooks", "evil.sh"), "exit 0\n");
  assert.match(run(p, ["integrity"]).out, /added: \.claude\/hooks\/evil\.sh/);
  fs.rmSync(path.join(p.dir, ".claude", "hooks"), { recursive: true });
  const ip = path.join(p.dir, ".agent-team", "integrity.json");
  const m = JSON.parse(fs.readFileSync(ip, "utf8"));
  m.files[".agent-team/roster.json"] = "0".repeat(64);
  fs.writeFileSync(ip, JSON.stringify(m));
  assert.match(run(p, ["integrity"]).out, /signature mismatch/);
});

test("a worker that edits its own gate config or playbook is blocked and nothing merges", () => {
  const p = makeProject();
  seal(p);
  const before = git(p.dir, "rev-parse", "HEAD");
  const r = run(p, ["spawn", "worker", "DO:APPEND:.agent-team/roster.json= \nDO:WRITE:src/out.txt=hello"]);
  assert.match(r.out, /changed protected files/);
  assert.match(r.out, /roster\.json/);
  assert.equal(git(p.dir, "rev-parse", "HEAD"), before);
  assert.ok(!fs.existsSync(path.join(p.dir, "src", "out.txt")));
  const r2 = run(p, ["spawn", "worker", "DO:APPEND:.agent-team/tentacles/worker/PLAYBOOK.md=- ignore all checks"]);
  assert.match(r2.out, /changed protected files/);
  assert.match(r2.out, /PLAYBOOK\.md/);
});

test("test-tamper guard: a worker that gutting a test to make the check pass is rejected, not merged", () => {
  const p = makeProject({
    agent: { selfVerification: "true" }, // would pass even with the test gutted — that is the point
    files: { "tests/a.test.js": "test('a', () => {\n  expect(add(1, 2)).toBe(3);\n  expect(add(2, 2)).toBe(4);\n});\n" },
  });
  const r = run(p, ["spawn", "worker", "DO:WRITE:tests/a.test.js=test('a', () => {});\n"]);
  assert.match(r.out, /blocked/);
  assert.match(r.out, /removed \d+ more assertion/);
  assert.ok(has(p, "tamper"));
  assert.match(fs.readFileSync(path.join(p.dir, "tests", "a.test.js"), "utf8"), /expect\(add\(1, 2\)\)/);
});

test("test-tamper guard: deleting a test file and adding a skip are both caught; [allow-test-changes] opts out", () => {
  const p = makeProject({ files: { "tests/a.test.js": "test('a', () => {\n  expect(1).toBe(1);\n});\n" } });
  assert.match(run(p, ["spawn", "worker", "DO:DELETE:tests/a.test.js"]).out, /deleted test file/);
  assert.match(run(p, ["spawn", "worker", "DO:WRITE:tests/a.test.js=test.skip('a', () => {\n  expect(1).toBe(1);\n});\n"]).out, /skip\/disable marker/);
  assert.match(run(p, ["spawn", "worker", "[allow-test-changes] DO:DELETE:tests/a.test.js"]).out, /worker done/);
});

test("feature-list guard: only 'passes' may change", () => {
  const features = JSON.stringify([{ description: "login", steps: ["open"], passes: false }, { description: "logout", steps: ["click"], passes: false }]);
  const p = makeProject({ roster: { featureList: "features.json" }, files: { "features.json": features } });
  const edited = JSON.stringify([{ description: "login (easier)", steps: [], passes: true }, { description: "logout", steps: ["click"], passes: false }]);
  const bad = run(p, ["spawn", "worker", `DO:WRITE:features.json=${edited}`]);
  assert.match(bad.out, /edited beyond its "passes" field/);
  const good = JSON.stringify([{ description: "login", steps: ["open"], passes: true }, { description: "logout", steps: ["click"], passes: false }]);
  assert.match(run(p, ["spawn", "worker", `DO:WRITE:features.json=${good}`]).out, /worker done/);
});

test("kill switch: STOP blocks dispatch, and a running worker is killed", () => {
  const p = makeProject();
  run(p, ["stop"]);
  const blocked = run(p, ["spawn", "worker", "DO:WRITE:src/x.txt=1"]);
  assert.match(blocked.out, /deferred — STOP file present/);
  run(p, ["resume"]);
  assert.match(run(p, ["spawn", "worker", "DO:WRITE:src/x.txt=1"]).out, /worker done/);

  const started = Date.now();
  const child = spawnSync(
    "node",
    [
      "-e",
      `const {spawn}=require('node:child_process');const fs=require('fs');
       const c=spawn('node',[${JSON.stringify(path.join(p.dir, ".agent-team", "orchestrator.mjs"))},'spawn','worker','DO:SLEEP:30000'],{cwd:${JSON.stringify(p.dir)},stdio:'inherit',env:process.env});
       setTimeout(()=>fs.writeFileSync(${JSON.stringify(path.join(p.dir, ".agent-team", "STOP"))},'x'),1500);
       c.on('close',()=>process.exit(0));`,
    ],
    { env: { ...process.env, HOME: p.home, USERPROFILE: p.home }, encoding: "utf8", timeout: 40000 },
  );
  assert.ok(Date.now() - started < 25000, `worker was not killed promptly (${Date.now() - started}ms)`);
  assert.match(child.stdout || "", /deferred/);
});

test("independent verifier: FAIL sends the work back and blocks; PASS merges; no verdict fails open", () => {
  const p = makeProject({ agent: { verifier: { provider: "fake" } } });
  const fail = run(p, ["spawn", "worker", "DO:WRITE:src/o.txt=1\nDO:VERDICT:FAIL"]);
  assert.match(fail.out, /blocked/);
  assert.match(fail.out, /independent reviewer rejected/);
  assert.ok(!fs.existsSync(path.join(p.dir, "src", "o.txt")));
  assert.match(run(p, ["spawn", "worker", "DO:WRITE:src/o.txt=1"]).out, /worker done/);
  const p2 = makeProject({ agent: { verifier: { provider: "fake" } } });
  assert.match(run(p2, ["spawn", "worker", "DO:WRITE:src/o.txt=1\nDO:VERDICT:NONE"]).out, /worker done/);
  assert.ok(events(p2).some((e) => e.type === "verifier" && e.verdict === "unavailable"));
});

test("verifier refuses a provider without read-only adviceArgs (lint error; fails open at runtime)", () => {
  const p = makeProject({ agent: { verifier: { provider: "noadvice" } } });
  assert.match(run(p, ["lint"]).out, /verifier provider "noadvice" has no read-only adviceArgs/);
  assert.match(run(p, ["spawn", "worker", "DO:WRITE:src/o.txt=1"]).out, /worker done/);
});

test("mergePolicy manual: passes verification but leaves the branch for a human", () => {
  const p = makeProject({ agent: { mergePolicy: "manual" } });
  const r = run(p, ["spawn", "worker", "DO:WRITE:src/o.txt=1"]);
  assert.match(r.out, /mergePolicy is manual/);
  assert.ok(!fs.existsSync(path.join(p.dir, "src", "o.txt")));
  assert.match(git(p.dir, "branch", "--list", "team/*"), /team\/worker-/);
  const rp = run(p, ["run-phase"]);
  assert.match(rp.out, /manual/);
  assert.match(fs.readFileSync(path.join(p.dir, ".agent-team", "STATUS.md"), "utf8"), /BLOCKED: awaiting human merge/);
});

test("integration check: failing after merge rolls the merge back", () => {
  const p = makeProject({ roster: { integrationCheck: "test ! -f src/BAD" } });
  const before = git(p.dir, "rev-parse", "HEAD");
  const r = run(p, ["spawn", "worker", "DO:WRITE:src/BAD=1"]);
  assert.match(r.out, /integration check failed \(merge rolled back\)/);
  assert.equal(git(p.dir, "rev-parse", "HEAD"), before);
  assert.ok(!fs.existsSync(path.join(p.dir, "src", "BAD")));
  const ok = run(p, ["spawn", "worker", "DO:WRITE:src/GOOD=1"]);
  assert.match(ok.out, /worker done/);
});

test("budget: passed through when the provider declares a budgetFlag, logged as unenforced when not", () => {
  const p = makeProject({ roster: { defaults: { maxBudgetUsd: 2 } } });
  run(p, ["spawn", "worker", "DO:WRITE:src/o.txt=1"]);
  assert.match(fs.readFileSync(p.argvLog, "utf8"), /"--budget","2"/);
  const q = makeProject({ roster: { defaults: { maxBudgetUsd: 2 } }, provider: { budgetFlag: undefined } });
  run(q, ["spawn", "worker", "DO:WRITE:src/o.txt=1"]);
  assert.ok(has(q, "budget_unenforced"));
  const bad = makeProject({ agent: { maxBudgetUsd: "lots" } });
  assert.match(run(bad, ["spawn", "worker", "DO:WRITE:src/o.txt=1"]).out, /maxBudgetUsd must be a positive number/);
});

test("ask: returns text, passes the model flag, refuses providers without adviceArgs and unsafe model ids", () => {
  const p = makeProject();
  const ok = run(p, ["ask", "fake", "--model", "opus"], { input: "hello" });
  assert.equal(ok.status, 0);
  assert.match(ok.out, /fake-answer/);
  assert.match(fs.readFileSync(p.argvLog, "utf8"), /"--advice","--model","opus"/);
  const no = run(p, ["ask", "noadvice"], { input: "hello" });
  assert.equal(no.status, 1);
  assert.match(no.out, /no "adviceArgs"/);
  assert.match(run(p, ["ask", "fake", "--model", "x; echo pwned"], { input: "hi" }).out, /outside \[A-Za-z0-9._:\/-\]/);
  assert.equal(run(p, ["ask", "nonexistent"], { input: "hi" }).status, 1);
});

test("lint: catches template placeholders, nesting tools, oversized playbooks and unvetted skills", () => {
  const p = makeProject({ agent: { selfVerification: "<the exact command>" } });
  const r = run(p, ["lint"]);
  assert.equal(r.status, 1);
  assert.match(r.out, /selfVerification is empty or still a template placeholder/);
  assert.match(r.out, /not sealed/);
  assert.match(r.out, /no \.agent-team\/allowlist\.json/);

  const q = makeProject({ files: { ".agent-team/allowlist.json": JSON.stringify({ skills: [], mcp: [] }) } });
  fs.writeFileSync(path.join(q.dir, ".claude", "agents", "worker.md"), AGENT_MD.replace("  - Edit", "  - Edit\n  - Agent"));
  fs.writeFileSync(path.join(q.dir, ".agent-team", "tentacles", "worker", "PLAYBOOK.md"), PLAYBOOK + "- filler\n".repeat(200));
  const r2 = run(q, ["lint"]);
  assert.match(r2.out, /tools includes Agent\/Task/);
  assert.match(r2.out, /skill "some-skill" is not in allowlist\.json/);
  assert.match(r2.out, /PLAYBOOK\.md is \d+ lines \(budget 150\)/);
});

test("lint: a real command containing a redirect is not mistaken for a template placeholder (found in a live run)", () => {
  const p = makeProject({ agent: { selfVerification: "docker compose config --quiet && bunx turbo run typecheck --dry=json > /dev/null" } });
  assert.doesNotMatch(run(p, ["lint"]).out, /selfVerification is empty or still a template placeholder/);
  const q = makeProject({ agent: { selfVerification: "<the exact command from agent.md>" } });
  assert.match(run(q, ["lint"]).out, /selfVerification is empty or still a template placeholder/);
});

test("routing: an untagged queue item matching two agents is blocked, not given to whichever is first (found in a live run)", () => {
  const p = makeProject({ files: { ".agent-team/STATUS.md": "# Status\n\n## Queue\n- [ ] audit the new endpoint\n" } });
  const rosterPath = path.join(p.dir, ".agent-team", "roster.json");
  const roster = JSON.parse(fs.readFileSync(rosterPath, "utf8"));
  roster.agents[0].routing = ["endpoint"];
  roster.agents.push({ ...roster.agents[0], name: "security", routing: ["audit"] });
  fs.writeFileSync(rosterPath, JSON.stringify(roster));
  git(p.dir, "add", "-A");
  git(p.dir, "commit", "-q", "-m", "two agents");
  const r = run(p, ["run-phase"]);
  assert.match(r.out, /ambiguous routing — worker, security all match/);
  assert.match(fs.readFileSync(path.join(p.dir, ".agent-team", "STATUS.md"), "utf8"), /BLOCKED: ambiguous routing/);
  assert.ok(!has(p, "dispatch_start"));
});

test("routing: hyphens and spaces match each other", () => {
  const p = makeProject({ agent: { routing: ["schema-drift"] }, files: { ".agent-team/STATUS.md": "# Status\n\n## Queue\n- [ ] write the schema drift check DO:WRITE:src/t.txt=1\n" } });
  assert.match(run(p, ["run-phase"]).out, /done in 1 attempt/);
});

test("playbook is injected into the prompt, and AGENT_TEAM_NO_PLAYBOOK=1 turns it off for A/B evals", () => {
  const p = makeProject();
  const dump = path.join(p.home, "prompt.txt");
  // The fake provider can't print its prompt without a directive, so assert via a verifier-free path:
  // run the orchestrator's own prompt builder by importing the template in a child process.
  const probe = spawnSync(
    "node",
    [
      "--input-type=module",
      "-e",
      `const src=(await import('node:fs')).readFileSync(${JSON.stringify(path.join(p.dir, ".agent-team", "orchestrator.mjs"))},'utf8');
       const start=src.indexOf('function buildPrompt'); const end=src.indexOf('// The prompt travels over stdin');
       const fn=new Function('fs','path','TEAM_DIR','trimOutput', src.slice(start,end)+'; return buildPrompt;');
       const fs=await import('node:fs'); const path=await import('node:path');
       const bp=fn(fs.default,path.default,${JSON.stringify(path.join(p.dir, ".agent-team"))},(t)=>t);
       const a={name:'worker',selfVerification:'true'};
       console.log('WITH:'+bp(a,'task',null,{}).includes('## Playbook'));
       process.env.AGENT_TEAM_NO_PLAYBOOK='1';
       console.log('WITHOUT:'+bp(a,'task',null,{}).includes('## Playbook'));`,
    ],
    { encoding: "utf8", cwd: p.dir },
  );
  assert.match(probe.stdout, /WITH:true/);
  assert.match(probe.stdout, /WITHOUT:false/);
  void dump;
});

test("eval runner: route evals catch overlap and missing triggers; dispatch evals grade outcomes with pass@k and A/B baseline", () => {
  const runner = fs.readFileSync(path.join(REPO, "assets", "evals", "eval-runner.mjs.template"), "utf8");
  const tasks = {
    tasks: [
      { id: "route-ok", kind: "route", prompt: "please do some work", expectAgent: "worker" },
      { id: "route-neg", kind: "route", prompt: "what is for lunch", expectAgent: null },
      { id: "route-bad", kind: "route", prompt: "what is for lunch", expectAgent: "worker" },
      { id: "d-pass", kind: "dispatch", agent: "worker", prompt: "DO:WRITE:src/a.txt=ok", graders: [{ type: "fileContains", path: "src/a.txt", text: "ok" }, { type: "diffTouchesOnly", globs: ["src/**"] }] },
      { id: "d-fail", kind: "dispatch", agent: "worker", prompt: "DO:WRITE:src/b.txt=bad", graders: [{ type: "fileContains", path: "src/b.txt", text: "good" }] },
    ],
  };
  const p = makeProject({ files: { ".agent-team/evals/run.mjs": runner, ".agent-team/evals/tasks.json": JSON.stringify(tasks) } });
  const route = spawnSync("node", [".agent-team/evals/run.mjs", "route"], { cwd: p.dir, encoding: "utf8" });
  assert.equal(route.status, 1);
  assert.match(route.stdout, /PASS  route-ok/);
  assert.match(route.stdout, /PASS  route-neg/);
  assert.match(route.stdout, /FAIL  route-bad/);

  const refuse = spawnSync("node", [".agent-team/evals/run.mjs", "dispatch", "--k", "2"], { cwd: p.dir, encoding: "utf8" });
  assert.match(refuse.stdout, /Refusing to start without --yes/);

  const env = { ...process.env, HOME: p.home, USERPROFILE: p.home };
  const real = spawnSync("node", [".agent-team/evals/run.mjs", "dispatch", "--yes", "--k", "2"], { cwd: p.dir, encoding: "utf8", env, timeout: 120000 });
  assert.match(real.stdout, /d-pass	100%	yes	yes/);
  assert.match(real.stdout, /d-fail	0%	no	no/);
  const files = fs.readdirSync(path.join(p.dir, ".agent-team", "evals")).filter((f) => f.startsWith("results-playbook-"));
  assert.equal(files.length, 1);
  const base = spawnSync("node", [".agent-team/evals/run.mjs", "dispatch", "--yes", "--k", "1", "--baseline", "--only", "d-pass"], { cwd: p.dir, encoding: "utf8", env, timeout: 120000 });
  assert.match(base.stdout, /BASELINE: playbook disabled/);
  const baseFile = fs.readdirSync(path.join(p.dir, ".agent-team", "evals")).find((f) => f.startsWith("results-baseline-"));
  const cmp = spawnSync("node", [".agent-team/evals/run.mjs", "compare", path.join(p.dir, ".agent-team/evals", files[0]), path.join(p.dir, ".agent-team/evals", baseFile)], { cwd: p.dir, encoding: "utf8" });
  assert.match(cmp.stdout, /d-pass	100%	100%	0 pts/);
  assert.equal(git(p.dir, "branch", "--list", "team/*").trim(), "", "eval trials must not leave branches behind");
});

test("SubagentStop gate (sh): blocks with exit 2 when sealed config changed, passes when clean, circuit-breaks after 3", () => {
  const tpl = fs.readFileSync(path.join(REPO, "assets", "subagent-gate.sh.template"), "utf8");
  // Keep the real header (functions, circuit breaker, tamper check); drop the per-layer placeholder blocks.
  const cut = tpl.indexOf("# One block per agent layer");
  assert.ok(cut > 0);
  const gate = tpl.slice(0, cut) + '\nrm -rf "$GATE_STATE_DIR" 2>/dev/null\nexit 0\n';
  const p = makeProject({ files: { ".claude/hooks/gate.sh": gate } });
  seal(p);
  const runGate = () => spawnSync("bash", [".claude/hooks/gate.sh"], { cwd: p.dir, encoding: "utf8", env: { ...process.env, HOME: p.home, USERPROFILE: p.home } });
  fs.writeFileSync(path.join(p.dir, "unrelated.txt"), "x"); // porcelain non-empty, protected files intact
  assert.equal(runGate().status, 0);
  const rp = path.join(p.dir, ".agent-team", "roster.json");
  fs.appendFileSync(rp, " ");
  const first = runGate();
  assert.equal(first.status, 2);
  assert.match(first.stderr, /protected files changed/);
  assert.equal(runGate().status, 2);
  assert.equal(runGate().status, 0, "third consecutive identical failure must fail open (circuit breaker)");
});

test("ownership guard: a worker that changes files outside its ownership is rejected; shared paths and contracts are allowed", () => {
  const p = makeProject({ roster: { sharedPaths: ["docs/shared/**"] } });
  const bad = run(p, ["spawn", "worker", "DO:WRITE:src/ok.txt=1\nDO:WRITE:package.json={}\nDO:WRITE:Makefile=x"]);
  assert.match(bad.out, /blocked/);
  assert.match(bad.out, /outside this agent's ownership: .*package\.json/);
  assert.ok(!fs.existsSync(path.join(p.dir, "src", "ok.txt")), "nothing may merge");
  const ok = run(p, ["spawn", "worker", "DO:WRITE:src/ok.txt=1\nDO:WRITE:docs/shared/n.md=1\nDO:WRITE:.claude/contracts/api-spec.md=1"]);
  assert.match(ok.out, /worker done/);
  const off = makeProject({ agent: { ownershipGuard: false } });
  assert.match(run(off, ["spawn", "worker", "DO:WRITE:package.json={}"]).out, /worker done/);
});

test("verifier: a verdict wrapped in markdown (**VERDICT: PASS**) is still read", () => {
  const p = makeProject({ agent: { verifier: { provider: "fake" } } });
  assert.match(run(p, ["spawn", "worker", "DO:WRITE:src/o.txt=1\nDO:VERDICT:BOLD"]).out, /worker done/);
  assert.ok(events(p).some((e) => e.type === "verifier" && e.verdict === "PASS"), "verdict must be parsed, not fail-open");
});

test("SubagentStop gate (PowerShell): same tamper behaviour as the sh gate", { skip: process.platform !== "win32" }, () => {
  const tpl = fs.readFileSync(path.join(REPO, "assets", "subagent-gate.ps1.template"), "utf8");
  const cut = tpl.indexOf("<# One block per agent layer");
  assert.ok(cut > 0);
  const gate = tpl.slice(0, cut) + "\nRemove-Item -Recurse -Force $GateStatePath -ErrorAction SilentlyContinue\nexit 0\n";
  const p = makeProject({ files: { ".claude/hooks/gate.ps1": gate } });
  seal(p);
  const runGate = () =>
    spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ".claude/hooks/gate.ps1"], { cwd: p.dir, encoding: "utf8", env: { ...process.env, HOME: p.home, USERPROFILE: p.home } });
  fs.writeFileSync(path.join(p.dir, "unrelated.txt"), "x");
  assert.equal(runGate().status, 0);
  fs.appendFileSync(path.join(p.dir, ".agent-team", "roster.json"), " ");
  const first = runGate();
  assert.equal(first.status, 2, first.stdout + first.stderr);
  assert.match(first.stderr, /protected files changed/);
  assert.equal(runGate().status, 2);
  assert.equal(runGate().status, 0, "third consecutive identical failure must fail open (circuit breaker)");
});

test("verifier sees files the worker just created (untracked); a skip marker in a NEW test file is caught (found in a live run)", () => {
  const p = makeProject({ agent: { verifier: { provider: "fake" } } });
  // The change is ONLY a new file. If the reviewer's diff omitted untracked files it would see "(empty diff)" and FAIL.
  assert.match(run(p, ["spawn", "worker", "DO:WRITE:src/brand-new.txt=hello"]).out, /worker done/);
  assert.ok(events(p).some((e) => e.type === "verifier" && e.verdict === "PASS"));
  const q = makeProject();
  assert.match(run(q, ["spawn", "worker", "DO:WRITE:tests/new.test.js=test.skip('x', () => {});"]).out, /skip\/disable marker/);
});

test("security gate: the orchestrator runs the project's own gate script in range mode on the worker's branch", () => {
  // The same script and the same .claude/security-sensitive-paths.txt as the commit-time hooks, so the
  // headless rule can't drift from the interactive one.
  const gate = fs
    .readFileSync(path.join(REPO, "assets", "security-gate.sh.template"), "utf8")
    .replace(/<test-file regex[^>]*>/, "\\.test\\.")
    .replace(/<security-agent-name>/g, "worker");
  const p = makeProject({
    roster: { securityAgent: "worker" },
    files: {
      ".claude/security-sensitive-paths.txt": "# comment\n^src/auth/\n?^src/planned/\n",
      ".claude/hooks/security-gate.sh": gate,
      ".claude/contracts/security-audit-log.md": "# Security audit log\n",
      "src/auth/existing.txt": "seed so the required pattern matches a tracked file\n",
    },
  });
  const blocked = run(p, ["spawn", "worker", "DO:WRITE:src/auth/login.txt=1"]);
  assert.match(blocked.out, /security gate blocked this change before merge/);
  assert.match(blocked.out, /src\/auth\/login\.txt/);
  assert.ok(!fs.existsSync(path.join(p.dir, "src", "auth", "login.txt")), "nothing may merge");
  assert.match(run(p, ["spawn", "worker", "DO:WRITE:src/other/x.txt=1"]).out, /worker done/);
});

test("security gate: a roster with a security agent but no gate script blocks the merge instead of skipping it", () => {
  const p = makeProject({ roster: { securityAgent: "worker" }, files: { ".claude/security-sensitive-paths.txt": "^src/\n" } });
  const r = run(p, ["spawn", "worker", "DO:WRITE:src/x.txt=1"]);
  assert.match(r.out, /security-gate\.\{sh,ps1\} is missing/);
  assert.ok(!fs.existsSync(path.join(p.dir, "src", "x.txt")), "nothing may merge");
});

test("lint: security-sensitive-paths.txt placeholders and invalid regexes are errors; missing file with a securityAgent warns", () => {
  const p = makeProject({
    roster: { securityAgent: "worker" },
    files: { ".claude/security-sensitive-paths.txt": "<route/endpoint regex>\n^ok/\n(unclosed\n" },
  });
  const r = run(p, ["lint"]);
  assert.match(r.out, /line 1 is still a template placeholder/);
  assert.match(r.out, /line 3 is not a valid regex/);
  const q = makeProject({ roster: { securityAgent: "worker" } });
  assert.match(run(q, ["lint"]).out, /no \.claude\/security-sensitive-paths\.txt — falling back/);
});

test("seal key lookup is path-canonical: sealed from an 8.3 short path, verified from the long path (found by CI on Windows)", { skip: process.platform !== "win32" }, () => {
  const p = makeProject();
  const short = (spawnSync(`for %I in ("${p.dir}") do @echo %~sI`, { shell: true, encoding: "utf8" }).stdout || "").trim();
  if (short.toLowerCase() === p.dir.toLowerCase()) return; // this machine has 8.3 names disabled; nothing to alias
  const viaShort = (args, env = {}) =>
    spawnSync("node", [path.join(short, ".agent-team", "orchestrator.mjs"), ...args], { cwd: short, encoding: "utf8", env: { ...process.env, HOME: p.home, USERPROFILE: p.home, ...env } });
  assert.equal(viaShort(["seal"], { AGENT_TEAM_ALLOW_NONINTERACTIVE_SEAL: "1" }).status, 0);
  const viaLong = run(p, ["integrity"]);
  assert.equal(viaLong.status, 0, viaLong.out);
});

test("shared-workspace mode: the orchestrator's own runtime files are neither an ownership violation nor committed (found in final review)", () => {
  // .gitignore emptied on purpose: runtime files are untracked in the repo root, as in a project that skipped the ignore lines.
  const p = makeProject({ agent: { worktree: false }, files: { ".gitignore": "" } });
  const r = run(p, ["spawn", "worker", "DO:WRITE:src/shared.txt=hello"]);
  assert.match(r.out, /worker done/);
  assert.equal(fs.readFileSync(path.join(p.dir, "src", "shared.txt"), "utf8"), "hello");
  const tracked = git(p.dir, "ls-files");
  assert.match(tracked, /src\/shared\.txt/);
  assert.doesNotMatch(tracked, /events\.jsonl/, "runtime files must never be committed");
});

test("seal: the gate's own circuit-breaker state files inside .claude/hooks are not tampering", () => {
  const p = makeProject();
  fs.mkdirSync(path.join(p.dir, ".claude", "hooks"), { recursive: true });
  fs.writeFileSync(path.join(p.dir, ".claude", "hooks", "gate.sh"), "exit 0\n");
  seal(p);
  // What the two gates write while running:
  fs.writeFileSync(path.join(p.dir, ".claude", "hooks", ".subagent-gate-state.json"), "{}");
  fs.mkdirSync(path.join(p.dir, ".claude", "hooks", ".subagent-gate-state"), { recursive: true });
  fs.writeFileSync(path.join(p.dir, ".claude", "hooks", ".subagent-gate-state", "layer_check"), "2");
  const ok = run(p, ["integrity"]);
  assert.equal(ok.status, 0, ok.out);
  // ...but anything else new in hooks/ is still flagged, including a look-alike name.
  fs.writeFileSync(path.join(p.dir, ".claude", "hooks", ".subagent-gate-state.json.bak"), "x");
  const bad = run(p, ["integrity"]);
  assert.equal(bad.status, 1);
  assert.match(bad.out, /added: \.claude\/hooks\/\.subagent-gate-state\.json\.bak/);
});

// ---- interactive-path hooks (payload shapes captured from a real Claude Code 2.1.207 subagent run) ----
const hook = (p, event, payload, env = {}) => run(p, ["hook", event], { input: JSON.stringify(payload), env });
const setRoster = (p, patch) => {
  const rp = path.join(p.dir, ".agent-team", "roster.json");
  const r = JSON.parse(fs.readFileSync(rp, "utf8"));
  Object.assign(r, patch);
  fs.writeFileSync(rp, JSON.stringify(r));
};

test("hook SubagentStart: injects the playbook digest as context for a roster agent only (the fix for playbooks nobody opened)", () => {
  const p = makeProject();
  const r = hook(p, "SubagentStart", { agent_type: "worker", agent_id: "a1", cwd: p.dir });
  assert.equal(r.status, 0);
  const ctx = JSON.parse(r.out).hookSpecificOutput;
  assert.equal(ctx.hookEventName, "SubagentStart");
  assert.match(ctx.additionalContext, /Your playbook/);
  assert.match(ctx.additionalContext, /Definition of done/);
  assert.match(ctx.additionalContext, /UNVERIFIED/);
  assert.doesNotMatch(ctx.additionalContext, /## Purpose/, "only the parts an agent cannot infer, not the whole file");
  assert.equal(hook(p, "SubagentStart", { agent_type: "general-purpose", agent_id: "a2" }).out.trim(), "", "built-in agents get nothing");
  assert.equal(hook(p, "SubagentStart", { agent_type: "worker", agent_id: "a3" }, { AGENT_TEAM_NO_PLAYBOOK: "1" }).out.trim(), "", "A/B switch turns it off");
  assert.ok(has(p, "subagent_start"));
});

test("hook SubagentStart: the digest is capped so the playbook cannot become the bloat it is meant to remove", () => {
  const p = makeProject({ roster: { playbookDigestLines: 10 } });
  // the fixture's last section is "Edge cases": 60 more bullets land in it
  fs.appendFileSync(path.join(p.dir, ".agent-team", "tentacles", "worker", "PLAYBOOK.md"), "- case\n".repeat(60));
  const ctx = JSON.parse(hook(p, "SubagentStart", { agent_type: "worker", agent_id: "a1" }).out).hookSpecificOutput.additionalContext;
  assert.match(ctx, /truncated/);
  assert.ok(ctx.split("\n").length < 25);
});

test("hook PreToolUse(Agent): upward model overrides are logged (warn), refused (enforce), or allowed with a stated reason", () => {
  const p = makeProject(); // worker.md declares sonnet
  const up = { tool_name: "Agent", tool_input: { subagent_type: "worker", model: "opus", prompt: "do it" } };
  assert.equal(hook(p, "PreToolUse", up).status, 0, "default policy is warn");
  const ev = events(p).find((e) => e.type === "dispatch_request");
  assert.equal(ev.declared, "sonnet");
  assert.equal(ev.requested, "opus");
  assert.equal(ev.up, true);
  setRoster(p, { modelPolicy: "enforce" });
  const blocked = hook(p, "PreToolUse", up);
  assert.equal(blocked.status, 2);
  assert.match(blocked.out, /Model override refused/);
  assert.equal(hook(p, "PreToolUse", { ...up, tool_input: { ...up.tool_input, prompt: "[escalate: failed twice] do it" } }).status, 0);
  assert.equal(hook(p, "PreToolUse", { ...up, tool_input: { subagent_type: "worker", prompt: "x" } }).status, 0, "no model = the agent's own");
  assert.equal(hook(p, "PreToolUse", { ...up, tool_input: { subagent_type: "worker", model: "haiku", prompt: "x" } }).status, 0, "going down is always fine");
  assert.equal(hook(p, "PreToolUse", { ...up, tool_input: { subagent_type: "general-purpose", model: "opus", prompt: "x" } }).status, 0, "non-roster agents are not policed");
});

test("hook PreToolUse(Write): a subagent cannot write outside its ownership or to protected files; the main session is not policed", () => {
  const p = makeProject();
  const w = (file, extra = {}) => hook(p, "PreToolUse", { tool_name: "Write", tool_input: { file_path: file }, agent_id: "a1", agent_type: "worker", cwd: p.dir, ...extra });
  assert.equal(w("src/ok.txt").status, 0);
  assert.equal(w(path.join(p.dir, "src", "abs.txt")).status, 0, "absolute paths inside the project are resolved");
  assert.equal(w(".claude/contracts/api-spec.md").status, 0, "contracts are always allowed");
  const own = w("docs/readme.md");
  assert.equal(own.status, 2);
  assert.match(own.out, /outside worker's ownership/);
  const prot = w(".agent-team/roster.json");
  assert.equal(prot.status, 2);
  assert.match(prot.out, /protected/);
  assert.equal(w(".agent-team/tentacles/worker/PLAYBOOK.md").status, 2);
  assert.equal(w(".claude/hooks/new-hook.sh").status, 2, "a NEW file in a sealed directory is protected too");
  assert.equal(hook(p, "PreToolUse", { tool_name: "Write", tool_input: { file_path: ".agent-team/roster.json" }, cwd: p.dir }).status, 0, "no agent_type = the main session");
  setRoster(p, { ownershipPolicy: "warn" });
  assert.equal(w("docs/readme.md").status, 0);
  assert.ok(events(p).some((e) => e.type === "ownership_violation" && e.policy === "warn"));
});

test("hook PreToolUse(Write): a subagent in an isolated worktree is judged by paths inside ITS checkout", () => {
  const p = makeProject();
  git(p.dir, "worktree", "add", "-q", path.join(p.dir, ".agent-team", "worktrees", "iso"), "-b", "iso");
  const wt = path.join(p.dir, ".agent-team", "worktrees", "iso");
  const w = (file) => hook(p, "PreToolUse", { tool_name: "Edit", tool_input: { file_path: path.join(wt, file) }, agent_id: "a1", agent_type: "worker", cwd: wt });
  assert.equal(w("src/ok.txt").status, 0, "owned path inside the worktree must not be mistaken for a foreign path");
  assert.equal(w("docs/x.md").status, 2);
  assert.equal(w(".agent-team/roster.json").status, 2);
});

test("hook PreToolUse(Write): payload cwd is the main root but the file is inside a linked worktree: judged inside that checkout", () => {
  const p = makeProject();
  const wt = path.join(p.dir, ".claude", "worktrees", "agent-1");
  git(p.dir, "worktree", "add", "-q", wt, "-b", "agent-1");
  const w = (file) => hook(p, "PreToolUse", { tool_name: "Edit", tool_input: { file_path: path.join(wt, file) }, agent_id: "a1", agent_type: "worker", cwd: p.dir });
  assert.equal(w("src/ok.txt").status, 0, "the owned path must not read as .claude/worktrees/agent-1/src/ok.txt");
  assert.equal(w("docs/x.md").status, 2, "and a foreign path is still refused");
  assert.equal(w(".agent-team/roster.json").status, 2, "and the protected list still applies inside the worktree");
  // a different repository nested under the project is not this repo's checkout
  const other = path.join(p.dir, "vendor", "other");
  fs.mkdirSync(other, { recursive: true });
  git(other, "init", "-q");
  assert.equal(hook(p, "PreToolUse", { tool_name: "Edit", tool_input: { file_path: path.join(other, "docs", "x.md") }, agent_id: "a1", agent_type: "worker", cwd: p.dir }).status, 2, "inside the main checkout's tree, so still judged as vendor/other/docs/x.md");
});

test("hook SubagentStop: a report without the playbook's CHECKS / UNVERIFIED block is sent back once, then let through", () => {
  const p = makeProject();
  const stop = (msg, extra = {}) => hook(p, "SubagentStop", { agent_type: "worker", agent_id: "a1", last_assistant_message: msg, stop_hook_active: false, ...extra });
  const bad = stop("All done, tests pass.");
  assert.equal(bad.status, 2);
  assert.match(bad.out, /missing the playbook's proof block/);
  assert.equal(stop("All done, tests pass.", { stop_hook_active: true }).status, 0, "one retry only: never a loop");
  assert.equal(stop("CHECKS\n1. PASS — typecheck — evidence: exit 0\nUNVERIFIED: none").status, 0);
  setRoster(p, { reportPolicy: "warn" });
  assert.equal(stop("no block").status, 0);
  setRoster(p, { reportPolicy: "off" });
  assert.equal(stop("no block").status, 0);
  assert.equal(hook(p, "SubagentStop", { agent_type: "general-purpose", last_assistant_message: "x" }).status, 0);
});

test("hook SubagentStop: logs de-duplicated token usage per agent from the subagent transcript", () => {
  const p = makeProject();
  const t = path.join(p.home, "agent.jsonl");
  const line = (id, out, ts) => JSON.stringify({ type: "assistant", timestamp: ts, message: { id, model: "claude-sonnet-5-5", usage: { input_tokens: 5, output_tokens: out, cache_read_input_tokens: 100, cache_creation_input_tokens: 7 }, content: [] } });
  // message m1 is logged on TWO lines (two content blocks) with the same usage: it must count once
  fs.writeFileSync(t, [line("m1", 100, "2026-01-01T00:00:00Z"), line("m1", 100, "2026-01-01T00:00:01Z"), line("m2", 50, "2026-01-01T00:01:00Z")].join("\n") + "\n");
  hook(p, "SubagentStop", { agent_type: "worker", agent_id: "a1", agent_transcript_path: t, last_assistant_message: "UNVERIFIED: none\nPASS — x" });
  const ev = events(p).find((e) => e.type === "subagent_stop");
  assert.equal(ev.agent, "worker");
  assert.equal(ev.turns, 2);
  assert.equal(ev.outTokens, 150);
  assert.deepEqual(ev.models, { "claude-sonnet-5-5": 2 });
  assert.equal(ev.ms, 60000);
});

test("usage: a message logged on several lines counts once at its FINAL usage, not the provisional first line or the sum", () => {
  const p = makeProject();
  const t = path.join(p.home, "agent2.jsonl");
  const line = (id, out, blocks) => JSON.stringify({ type: "assistant", timestamp: "2026-01-01T00:00:00Z", message: { id, model: "claude-haiku-5-5", usage: { input_tokens: 10, output_tokens: out, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, content: [{ type: blocks }] } });
  // as seen in a real transcript: thinking(6) / text(6) / tool_use(501) for one message, then 1 / 181 for the next
  fs.writeFileSync(t, [line("mA", 6, "thinking"), line("mA", 6, "text"), line("mA", 501, "tool_use"), line("mB", 1, "thinking"), line("mB", 181, "text")].join("\n") + "\n");
  hook(p, "SubagentStop", { agent_type: "worker", agent_id: "u1", agent_transcript_path: t, last_assistant_message: "UNVERIFIED: none\nPASS — x" });
  const ev = events(p).find((e) => e.type === "subagent_stop");
  assert.equal(ev.turns, 2);
  assert.equal(ev.outTokens, 682, "501 + 181");
});

test("hook SubagentStop: checks weakened during the run are flagged (warn) or sent back (enforce), against the commit recorded at start", () => {
  const p = makeProject({ files: { "tests/a.test.js": "test('a', () => {\n  expect(1).toBe(1);\n  expect(2).toBe(2);\n});\n" } });
  const start = { agent_type: "worker", agent_id: "a9", cwd: p.dir };
  const ok = "CHECKS\n1. PASS — x — evidence: y\nUNVERIFIED: none";
  hook(p, "SubagentStart", start);
  fs.writeFileSync(path.join(p.dir, "tests", "a.test.js"), "test('a', () => {});\n");
  const warn = hook(p, "SubagentStop", { ...start, last_assistant_message: ok });
  assert.equal(warn.status, 0, "default is warn");
  assert.ok(events(p).some((e) => e.type === "tamper_suspected"));
  setRoster(p, { tamperPolicy: "enforce" });
  hook(p, "SubagentStart", { ...start, agent_id: "b1" });
  fs.writeFileSync(path.join(p.dir, "tests", "a.test.js"), "test('a', () => {});\n// again\n");
  git(p.dir, "checkout", "--", "tests/a.test.js");
  fs.writeFileSync(path.join(p.dir, "tests", "a.test.js"), "test.skip('a', () => { expect(1).toBe(1); expect(2).toBe(2); });\n");
  const enf = hook(p, "SubagentStop", { ...start, agent_id: "b1", last_assistant_message: ok });
  assert.equal(enf.status, 2);
  assert.match(enf.out, /weakened/);
});

test("hooks fail open: bad stdin, a missing roster, or an unknown event never block anything", () => {
  const p = makeProject();
  assert.equal(run(p, ["hook", "PreToolUse"], { input: "not json {{" }).status, 0);
  assert.equal(run(p, ["hook", "NoSuchEvent"], { input: "{}" }).status, 0);
  fs.rmSync(path.join(p.dir, ".agent-team", "roster.json"));
  assert.equal(hook(p, "PreToolUse", { tool_name: "Write", tool_input: { file_path: "x" }, agent_type: "worker" }).status, 0);
});

test("hook runs against CLAUDE_PROJECT_DIR even when Claude Code starts it from a subdirectory", () => {
  const p = makeProject();
  fs.mkdirSync(path.join(p.dir, "src", "deep"), { recursive: true });
  const r = spawnSync("node", [path.join(p.dir, ".agent-team", "orchestrator.mjs"), "hook", "SubagentStart"], {
    cwd: path.join(p.dir, "src", "deep"),
    encoding: "utf8",
    input: JSON.stringify({ agent_type: "worker", agent_id: "a1" }),
    env: { ...process.env, HOME: p.home, USERPROFILE: p.home, CLAUDE_PROJECT_DIR: p.dir },
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Your playbook/);
});

// ---- usage report (read from Claude Code transcripts) ----
function fakeTranscripts(root, runs) {
  // runs: [{ id, type, requested, model, out, readPlaybook, report, prompt }]
  const sub = path.join(root, "sess1", "subagents");
  fs.mkdirSync(sub, { recursive: true });
  const main = [];
  const at = "2026-01-01T00:00:00Z";
  for (const r of runs) {
    main.push(JSON.stringify({ type: "assistant", timestamp: at, message: { id: "mm-" + r.id, model: "claude-opus-5-5", usage: { output_tokens: 10 }, content: [{ type: "tool_use", id: "tu-" + r.id, name: "Agent", input: { subagent_type: r.type, model: r.requested || undefined, prompt: r.prompt || "do it" } }] } }));
    fs.writeFileSync(path.join(sub, `agent-${r.id}.meta.json`), JSON.stringify({ agentType: r.type, model: r.requested || null, toolUseId: "tu-" + r.id }));
    const lines = [];
    if (r.readPlaybook) lines.push(JSON.stringify({ type: "assistant", timestamp: at, message: { id: "r1-" + r.id, model: r.model, usage: { output_tokens: 5 }, content: [{ type: "tool_use", id: "x", name: "Read", input: { file_path: ".agent-team/tentacles/" + r.type + "/PLAYBOOK.md" } }] } }));
    lines.push(JSON.stringify({ type: "assistant", timestamp: at, message: { id: "f1-" + r.id, model: r.model, usage: { output_tokens: 1 }, content: [{ type: "thinking" }] } }));
    lines.push(JSON.stringify({ type: "assistant", timestamp: "2026-01-01T00:01:00Z", message: { id: "f1-" + r.id, model: r.model, usage: { output_tokens: r.out }, content: [{ type: "text", text: r.report ? "CHECKS\n1. PASS — a — evidence: b\nUNVERIFIED: none" : "done" }] } }));
    fs.writeFileSync(path.join(sub, `agent-${r.id}.jsonl`), lines.join("\n") + "\n");
  }
  fs.writeFileSync(path.join(root, "sess1.jsonl"), main.join("\n") + "\n");
}

test("usage: per-agent runs, tokens, playbook uptake, report format and unexplained upward model overrides", () => {
  const p = makeProject(); // worker.md declares sonnet
  const t = path.join(p.home, "transcripts");
  fakeTranscripts(t, [
    { id: "a", type: "worker", requested: "opus", model: "claude-opus-5-5", out: 1000, readPlaybook: true, report: true, prompt: "[escalate: failed twice] fix" },
    { id: "b", type: "worker", requested: "opus", model: "claude-opus-5-5", out: 3000, readPlaybook: false, report: false },
    { id: "c", type: "general-purpose", requested: "sonnet", model: "claude-sonnet-5-5", out: 200, readPlaybook: false, report: false },
  ]);
  const r = run(p, ["usage", "--json", "--transcripts", t]);
  assert.equal(r.status, 0, r.out);
  const rep = JSON.parse(r.out);
  assert.equal(rep.totalRuns, 3);
  assert.equal(rep.totalOut, 4205, "each message counted once at its final usage: 1000+3000+200, plus the 5-token playbook-read message");
  const w = rep.per.find((x) => x.agent === "worker");
  assert.equal(w.runs, 2);
  assert.equal(w.playbookRead, 1);
  assert.equal(w.reportBlock, 1);
  assert.equal(w.up, 2, "both asked for opus over a sonnet-declared agent");
  assert.equal(w.upExplained, 1, "only one carried [escalate: reason]");
  assert.ok(rep.flags.some((f) => /worker: 1 dispatch\(es\) asked for a costlier model/.test(f)));
  const txt = run(p, ["usage", "--transcripts", t]).out;
  assert.match(txt, /subagent runs: 3/);
  assert.match(txt, /attention:/);
});

test("usage: flags an agent that does almost no work, and the top model dominating despite the declared tiers", () => {
  const p = makeProject();
  const rp = path.join(p.dir, ".agent-team", "roster.json");
  const roster = JSON.parse(fs.readFileSync(rp, "utf8"));
  roster.agents.push({ ...roster.agents[0], name: "idle", routing: ["idle"] });
  fs.writeFileSync(rp, JSON.stringify(roster));
  const runs = Array.from({ length: 22 }, (_, i) => ({ id: "w" + i, type: "worker", requested: "opus", model: "claude-opus-5-5", out: 500, readPlaybook: true, report: true, prompt: "[escalate: x]" }));
  const t = path.join(p.home, "transcripts2");
  fakeTranscripts(t, runs);
  const rep = JSON.parse(run(p, ["usage", "--json", "--transcripts", t]).out);
  assert.ok(rep.flags.some((f) => /idle: 0 of 22 runs/.test(f) && /dormant/.test(f)));
  assert.ok(rep.flags.some((f) => /model tiering is not in effect/.test(f)));
  assert.equal(run(p, ["usage", "--transcripts", path.join(p.home, "nothing-here")]).status, 1);
});

test("dormant: an agent flagged dormant is not routed to, and lint says so", () => {
  const p = makeProject({ agent: { dormant: true, routing: ["work"] }, files: { ".agent-team/STATUS.md": "# Status\n\n## Queue\n- [ ] do some work\n" } });
  const r = run(p, ["run-phase"]);
  assert.match(r.out, /no agent matches queue item/);
  assert.match(run(p, ["lint"]).out, /\[info\] agent worker: dormant/);
});

// ---- risk: how deep must a security audit go ----
function riskProject() {
  return makeProject({
    files: {
      ".claude/security-sensitive-paths.txt": "# sensitive\n^src/auth/\n",
      "src/auth/a.ts": "import { x } from '@/old/x';\nexport const a = x + 1;\n",
      "src/auth/b.ts": "export const b = 2;\n",
      "src/auth/d.ts": "// old comment\nexport const d = 4;\n",
      "src/auth/e.ts": "import { s } from '@/old/s';\nexport function check(u) { return s(u); }\n",
      "src/other/z.ts": "export const z = 1;\n",
    },
  });
}
const writeFile = (p, rel, content) => fs.writeFileSync(path.join(p.dir, rel), content);
const riskOf = (p, ...args) => JSON.parse(run(p, ["risk", "--json", ...args]).out);

test("risk: renames, comment edits and re-pointed imports are 'light'; files outside the sensitive list are ignored", () => {
  const p = riskProject();
  git(p.dir, "mv", "src/auth/b.ts", "src/auth/c.ts");
  writeFile(p, "src/auth/d.ts", "// new comment\nexport const d = 4;\n");
  writeFile(p, "src/auth/a.ts", "import { x } from '@new/x';\nexport const a = x + 1;\n");
  writeFile(p, "src/other/z.ts", "export const z = 999; // logic change, but not a sensitive path\n");
  const rep = riskOf(p);
  const by = Object.fromEntries(rep.files.map((f) => [f.file, f.cls]));
  assert.equal(by["src/auth/c.ts"], "mechanical", "100% rename");
  assert.equal(by["src/auth/d.ts"], "mechanical", "comment only");
  assert.equal(by["src/auth/a.ts"], "import-only", "same binding, new path");
  assert.equal(by["src/other/z.ts"], undefined);
  assert.equal(rep.depth, "light");
  assert.match(rep.advice, /Light audit/);
});

test("risk: new code, new bindings, new or deleted files push the whole change to a full audit", () => {
  const p = riskProject();
  writeFile(p, "src/auth/a.ts", "import { x } from '@new/x';\nexport const a = x + 1;\n"); // light on its own
  assert.equal(riskOf(p).depth, "light");
  writeFile(p, "src/auth/e.ts", "import { s, t } from '@old/s';\nexport function check(u) { return s(u) && t(u); }\n");
  const rep = riskOf(p);
  assert.equal(rep.depth, "full");
  assert.equal(rep.files.find((f) => f.file === "src/auth/e.ts").cls, "logic");
  assert.match(rep.advice, /Full audit for 1 file/);
  writeFile(p, "src/auth/new.ts", "export const n = 1;\n");
  assert.equal(riskOf(p).files.find((f) => f.file === "src/auth/new.ts").cls, "logic", "an untracked new file is never light");
  fs.rmSync(path.join(p.dir, "src", "auth", "d.ts"));
  assert.equal(riskOf(p).files.find((f) => f.file === "src/auth/d.ts").cls, "logic", "a deleted file is never light");
});

test("risk: an import that gains or loses a binding is logic even if the path is unchanged; no sensitive change = none", () => {
  const p = riskProject();
  assert.equal(riskOf(p).depth, "none");
  writeFile(p, "src/auth/a.ts", "import { x, y } from '@/old/x';\nexport const a = x + y;\n");
  assert.equal(riskOf(p).files.find((f) => f.file === "src/auth/a.ts").cls, "logic");
});

test("risk: works on a committed range and on staged changes", () => {
  const p = riskProject();
  writeFile(p, "src/auth/a.ts", "import { x } from '@new/x';\nexport const a = x + 1;\n");
  git(p.dir, "add", "-A");
  assert.equal(riskOf(p, "--staged").depth, "light");
  git(p.dir, "commit", "-q", "-m", "repoint");
  assert.equal(riskOf(p, "HEAD~1", "HEAD").depth, "light");
  assert.equal(run(p, ["risk", "no-such-ref"]).status, 1);
});

// ---- lint: checks that depend on the agent's word, evals never run, lessons in two places ----
const DOD_MOSTLY_REPORTED = `# Worker — Playbook

## Definition of done
| # | Check | Evidence | How to run | Enforced by |
|---|-------|----------|------------|-------------|
| 1 | Self-verification passes | exit code 0 | \`true\` | gate |
| 2 | Counts reported | passed/failed/skipped quoted | read the report | agent-reported |
| 3 | No skipped test | skipped = 0 | read the report | agent-reported |
| 4 | Edge case covered | test name in the report | read the report | agent-reported |
`;

test("lint: a playbook whose Definition of done is mostly 'agent-reported' is flagged, and an unused files/checks.sh too", () => {
  const p = makeProject();
  fs.writeFileSync(path.join(p.dir, ".agent-team", "tentacles", "worker", "PLAYBOOK.md"), DOD_MOSTLY_REPORTED);
  const out = run(p, ["lint"]).out;
  assert.match(out, /3 of 4 Definition-of-done checks are only agent-reported/);
  assert.match(out, /checks\.sh/);
  fs.mkdirSync(path.join(p.dir, ".agent-team", "tentacles", "worker", "files"), { recursive: true });
  fs.writeFileSync(path.join(p.dir, ".agent-team", "tentacles", "worker", "files", "checks.sh"), "exit 0\n");
  assert.match(run(p, ["lint"]).out, /files\/checks\.sh exists but selfVerification never runs it/);
  const rp = path.join(p.dir, ".agent-team", "roster.json");
  const r = JSON.parse(fs.readFileSync(rp, "utf8"));
  r.agents[0].selfVerification = "bash .agent-team/tentacles/worker/files/checks.sh && true";
  fs.writeFileSync(rp, JSON.stringify(r));
  assert.doesNotMatch(run(p, ["lint"]).out, /exists but selfVerification never runs it/);
});

test("lint: evals that were configured but never run are called out; a missing baseline is noted", () => {
  const p = makeProject();
  assert.match(run(p, ["lint"]).out, /\[info\] no evals configured/);
  fs.mkdirSync(path.join(p.dir, ".agent-team", "evals"), { recursive: true });
  fs.writeFileSync(path.join(p.dir, ".agent-team", "evals", "tasks.json"), JSON.stringify({ tasks: [{ id: "r1", kind: "route", prompt: "x", expectAgent: "worker" }] }));
  assert.match(run(p, ["lint"]).out, /only routing tasks/);
  fs.writeFileSync(path.join(p.dir, ".agent-team", "evals", "tasks.json"), JSON.stringify({ tasks: [{ id: "d1", kind: "dispatch", agent: "worker", prompt: "x", graders: [] }] }));
  assert.match(run(p, ["lint"]).out, /1 dispatch task\(s\) defined but no results file/);
  fs.writeFileSync(path.join(p.dir, ".agent-team", "evals", "results-playbook-1.json"), "{}");
  const out = run(p, ["lint"]).out;
  assert.doesNotMatch(out, /no results file/);
  assert.match(out, /no --baseline/);
});

test("lint: lessons logged in two places are flagged; one configured lessonsFile resolves it", () => {
  const p = makeProject({ files: { "lessons.md": "# Lessons\n\n- never rename the suffix\n", ".agent-team/tentacles/worker/notes.md": "# Notes\n" } });
  assert.match(run(p, ["lint"]).out, /corrections are logged in two places: lessons\.md/);
  const rp = path.join(p.dir, ".agent-team", "roster.json");
  const r = JSON.parse(fs.readFileSync(rp, "utf8"));
  r.lessonsFile = "lessons.md";
  fs.writeFileSync(rp, JSON.stringify(r));
  assert.doesNotMatch(run(p, ["lint"]).out, /two places/);
  r.lessonsFile = "missing-file.md";
  fs.writeFileSync(rp, JSON.stringify(r));
  assert.match(run(p, ["lint"]).out, /\[error\] lessonsFile "missing-file\.md" does not exist/);
});

// ---- models: families, fable tier, effort ----
test("models: fable outranks opus, so an unexplained upgrade to it is caught; pinned ids are judged by family", () => {
  const p = makeProject(); // worker.md declares sonnet
  setRoster(p, { modelPolicy: "enforce" });
  const call = (model, prompt = "x") => hook(p, "PreToolUse", { tool_name: "Agent", tool_input: { subagent_type: "worker", model, prompt } });
  assert.equal(call("fable").status, 2);
  assert.equal(call("claude-fable-5-1").status, 2, "a pinned id is still the fable family");
  assert.equal(call("claude-opus-4-6").status, 2, "opus over a sonnet agent");
  assert.equal(call("claude-sonnet-5-5").status, 0, "same family, pinned");
  assert.equal(call("fable", "[escalate: opus failed twice] x").status, 0, "a stated reason is allowed");
  assert.ok(events(p).some((e) => e.type === "dispatch_request" && e.requested === "fable" && e.up === true));
});

test("lint: fable or xhigh/max as an agent's default, an unknown model or an invalid effort are flagged", () => {
  const p = makeProject();
  const af = path.join(p.dir, ".claude", "agents", "worker.md");
  const set = (model, effort) => fs.writeFileSync(af, AGENT_MD.replace("model: sonnet", `model: ${model}` + (effort ? `\neffort: ${effort}` : "")));
  set("fable");
  assert.match(run(p, ["lint"]).out, /model fable is the top tier and draws on a separate credit pool/);
  set("sonnet", "max");
  assert.match(run(p, ["lint"]).out, /effort max is the most expensive setting/);
  set("sonnet", "turbo");
  assert.match(run(p, ["lint"]).out, /effort "turbo" is not one of/);
  set("gpt-9");
  assert.match(run(p, ["lint"]).out, /model "gpt-9" is not an alias/);
  set("claude-sonnet-5-5", "medium");
  const clean = run(p, ["lint"]).out;
  assert.doesNotMatch(clean, /model "|effort|fable/);
});

// ---- stamp: reuse a check that already passed for this exact tree ----
test("stamp: valid for the same tree, stale after any change (tracked edit, new file), never fooled by the orchestrator's own files", () => {
  const p = makeProject({ files: { "src/a.txt": "one\n" } });
  assert.equal(run(p, ["stamp", "check", "suite"]).status, 1, "no stamp yet");
  assert.equal(run(p, ["stamp", "write", "suite"]).status, 0);
  const ok = run(p, ["stamp", "check", "suite"]);
  assert.equal(ok.status, 0, "stamps.json and events.jsonl are the orchestrator's own files and must not change the fingerprint");
  assert.match(ok.out, /valid: "suite" passed/);
  fs.writeFileSync(path.join(p.dir, "src", "a.txt"), "two\n");
  assert.match(run(p, ["stamp", "check", "suite"]).out, /stale: the tree changed/);
  fs.writeFileSync(path.join(p.dir, "src", "a.txt"), "one\n");
  assert.equal(run(p, ["stamp", "check", "suite"]).status, 0, "restoring the file restores the fingerprint");
  fs.writeFileSync(path.join(p.dir, "src", "new.txt"), "x");
  assert.equal(run(p, ["stamp", "check", "suite"]).status, 1, "a new untracked file changes the tree");
  assert.equal(run(p, ["stamp", "check", "other-label"]).status, 1);
});

test("stamp: a commit changes HEAD, and --max-age-min refuses an old stamp", () => {
  const p = makeProject();
  run(p, ["stamp", "write", "suite"]);
  fs.writeFileSync(path.join(p.dir, "f.txt"), "x");
  git(p.dir, "add", "f.txt"); // stamps.json is runtime state and belongs in .gitignore; don't commit it here
  git(p.dir, "commit", "-q", "-m", "more");
  assert.equal(run(p, ["stamp", "check", "suite"]).status, 1, "new HEAD");
  git(p.dir, "reset", "-q", "--hard", "HEAD~1");
  assert.equal(run(p, ["stamp", "check", "suite"]).status, 0, "back at the stamped tree");
  const sp = path.join(p.dir, ".agent-team", "stamps.json");
  const s = JSON.parse(fs.readFileSync(sp, "utf8"));
  s.suite.at = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
  fs.writeFileSync(sp, JSON.stringify(s));
  assert.match(run(p, ["stamp", "check", "suite", "--max-age-min", "60"]).out, /stale: "suite" was stamped 180 min ago/);
  assert.equal(run(p, ["stamp", "check", "suite"]).status, 0, "no age limit: still valid for the tree");
});

// ---- plan: which queue items can run side by side ----
test("plan: independent agents share a batch; the same agent, overlapping ownership and [after:N] are kept apart", () => {
  const status = [
    "# Status", "", "## Queue",
    "- [ ] [worker] first change",
    "- [ ] [docs] write the docs",
    "- [ ] [worker] second change",
    "- [ ] [docs] more docs [after:1]",
    "- [ ] [wide] api work under the worker's tree",
    "",
  ].join("\n");
  const p = makeProject({ files: { ".agent-team/STATUS.md": status } });
  const rp = path.join(p.dir, ".agent-team", "roster.json");
  const r = JSON.parse(fs.readFileSync(rp, "utf8"));
  r.agents.push({ ...r.agents[0], name: "docs", ownership: ["docs/**"], routing: ["docs"] });
  r.agents.push({ ...r.agents[0], name: "wide", ownership: ["src/api/**"], routing: ["api"] });
  fs.writeFileSync(rp, JSON.stringify(r));
  const batches = JSON.parse(run(p, ["plan", "--json"]).out);
  const where = (n) => batches.findIndex((b) => b.some((x) => x.n === n));
  assert.equal(where(1), 0);
  assert.equal(where(2), 0, "docs is independent of worker: same batch");
  assert.ok(where(3) > where(1), "same agent twice is sequential");
  assert.ok(where(4) > where(1), "[after:1] waits for item 1");
  assert.ok(where(5) > where(1), "wide's ownership sits inside worker's tree: they conflict");
  assert.match(run(p, ["plan"]).out, /batch 1 {2}— 2 independent items: dispatch together, each in its own worktree/);
});

test("plan: an item that cannot be routed is never batched in parallel with anything", () => {
  const p = makeProject({ files: { ".agent-team/STATUS.md": "# Status\n\n## Queue\n- [ ] [worker] real work\n- [ ] something nobody owns\n" } });
  const batches = JSON.parse(run(p, ["plan", "--json"]).out);
  assert.equal(batches.length, 2);
  assert.equal(batches[1][0].agent, null);
});

// ---- usage: active time and concurrency ----
test("usage: concurrency counts ACTIVE time, so a run resumed hours later is not mistaken for parallel work, and strictly serial work is flagged", () => {
  const p = makeProject();
  const t = path.join(p.home, "transcripts-serial");
  const sub = path.join(t, "s1", "subagents");
  fs.mkdirSync(sub, { recursive: true });
  const base = Date.parse("2026-01-01T00:00:00Z");
  const iso = (ms) => new Date(base + ms).toISOString();
  const msg = (id, ts, extra = {}) => JSON.stringify({ type: "assistant", timestamp: ts, message: { id, model: "claude-sonnet-5-5", usage: { output_tokens: 10 }, content: [{ type: "text", text: "x" }], ...extra } });
  // twelve runs, one after another, each 40 minutes of active work
  for (let i = 0; i < 12; i++) {
    const s0 = i * 3600_000; // one per hour
    fs.writeFileSync(path.join(sub, `agent-${i}.meta.json`), JSON.stringify({ agentType: "worker" }));
    fs.writeFileSync(path.join(sub, `agent-${i}.jsonl`), [msg("a" + i, iso(s0)), msg("b" + i, iso(s0 + 15 * 60_000)), msg("c" + i, iso(s0 + 40 * 60_000))].join("\n") + "\n");
  }
  // a 13th run: active at the start, then resumed 30 hours later for one message. First-to-last would span 30h and
  // overlap everything; active segments must not.
  fs.writeFileSync(path.join(sub, "agent-late.meta.json"), JSON.stringify({ agentType: "worker" }));
  fs.writeFileSync(path.join(sub, "agent-late.jsonl"), [msg("l1", iso(0)), msg("l2", iso(5 * 60_000)), msg("l3", iso(30 * 3600_000))].join("\n") + "\n");
  fs.writeFileSync(path.join(t, "s1.jsonl"), "");
  const rep = JSON.parse(run(p, ["usage", "--json", "--transcripts", t]).out);
  assert.equal(rep.concurrency.maxConcurrent, 2, "only the first hour has the late run's first segment next to run 0");
  assert.ok(rep.concurrency.overlapPct < 15, `overlap ${rep.concurrency.overlapPct}%`);
  assert.ok(rep.concurrency.agentMinutes < 12 * 41 + 10, "the 30-hour gap is not counted as work");
  assert.ok(rep.flags.some((f) => /one agent at a time/.test(f)));
});

test("usage: a security agent run again and again back-to-back is flagged as an audit loop; spaced-out audits are not", () => {
  const p = makeProject({ roster: { securityAgent: "worker" } });
  const mk = (name, startsMin) => {
    const t = path.join(p.home, name);
    const sub = path.join(t, "s", "subagents");
    fs.mkdirSync(sub, { recursive: true });
    const base = Date.parse("2026-01-01T00:00:00Z");
    startsMin.forEach((m, i) => {
      const at = (x) => new Date(base + (m + x) * 60000).toISOString();
      const line = (id, ts) => JSON.stringify({ type: "assistant", timestamp: ts, message: { id, model: "claude-opus-5-5", usage: { output_tokens: 5 }, content: [{ type: "text", text: "x" }] } });
      fs.writeFileSync(path.join(sub, `agent-${i}.meta.json`), JSON.stringify({ agentType: "worker" }));
      fs.writeFileSync(path.join(sub, `agent-${i}.jsonl`), [line("a" + i, at(0)), line("b" + i, at(20))].join("\n") + "\n");
    });
    fs.writeFileSync(path.join(t, "s.jsonl"), "");
    return JSON.parse(run(p, ["usage", "--json", "--transcripts", t]).out);
  };
  // five audits, each starting 30 minutes after the previous one ended: a loop
  assert.ok(mk("loop", [0, 50, 100, 150, 200]).flags.some((f) => /audit chain\(s\) of 3\+ back-to-back runs \(longest 5\)/.test(f)));
  // five audits spread over days: not a loop
  assert.ok(!mk("spaced", [0, 3000, 6000, 9000, 12000]).flags.some((f) => /audit chain/.test(f)));
  // two back-to-back is a normal fix-and-recheck
  assert.ok(!mk("pair", [0, 50]).flags.some((f) => /audit chain/.test(f)));
});

test("lint: a roster of more than five active agents gets a size note; dormant agents don't count", () => {
  const p = makeProject();
  const rp = path.join(p.dir, ".agent-team", "roster.json");
  const r = JSON.parse(fs.readFileSync(rp, "utf8"));
  for (let i = 0; i < 6; i++) r.agents.push({ ...r.agents[0], name: "extra" + i, routing: ["extra" + i] });
  fs.writeFileSync(rp, JSON.stringify(r));
  assert.match(run(p, ["lint"]).out, /7 active agents: each adds a playbook/);
  for (let i = 0; i < 6; i++) r.agents[i + 1].dormant = true;
  fs.writeFileSync(rp, JSON.stringify(r));
  assert.doesNotMatch(run(p, ["lint"]).out, /active agents: each adds/);
});

test("hook PreToolUse(Write): a payload that spells the project with a Windows 8.3 short path is still policed (found by CI)", { skip: process.platform !== "win32" }, () => {
  const p = makeProject();
  const short = (spawnSync(`for %I in ("${p.dir}") do @echo %~sI`, { shell: true, encoding: "utf8" }).stdout || "").trim();
  if (!short || short.toLowerCase() === p.dir.toLowerCase()) return; // this machine has 8.3 names off: nothing to alias
  const w = (file) => hook(p, "PreToolUse", { tool_name: "Write", tool_input: { file_path: path.join(short, file) }, agent_id: "a1", agent_type: "worker", cwd: short });
  assert.equal(w("docs/readme.md").status, 2, "outside ownership must be refused even when the path is spelled short");
  assert.equal(w(".agent-team/roster.json").status, 2, "and so must a sealed file");
  assert.equal(w("src/ok.txt").status, 0);
});

// ---- tiers: running the same task on different models, fairly ----
const modelsUsed = (p) =>
  fs.existsSync(p.argvLog)
    ? fs.readFileSync(p.argvLog, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((a) => !a.includes("--advice") && a.includes("--model")).map((a) => a[a.indexOf("--model") + 1])
    : [];

test("spawn --tier starts on that tier and, by default, escalates one tier per failed attempt; --no-escalate pins it", () => {
  const tiers = { light: "haiku", default: "sonnet", high: "opus" };
  const p = makeProject({ provider: { tiers }, agent: { selfVerification: "false" } });
  run(p, ["spawn", "worker", "DO:WRITE:src/a.txt=1", "--tier", "light"]);
  assert.deepEqual(modelsUsed(p), ["haiku", "sonnet", "opus"], "light -> default -> high across the three attempts");
  const q = makeProject({ provider: { tiers }, agent: { selfVerification: "false" } });
  run(q, ["spawn", "worker", "DO:WRITE:src/a.txt=1", "--tier", "light", "--no-escalate"]);
  assert.deepEqual(modelsUsed(q), ["haiku", "haiku", "haiku"], "a model comparison must not quietly retry on a bigger model");
  assert.match(run(q, ["spawn", "worker", "x", "--tier", "turbo"]).out, /--tier must be one of light, default, high/);
});

test("eval runner --tiers runs each task on each tier with escalation off and reports a per-tier comparison", () => {
  const runner = fs.readFileSync(path.join(REPO, "assets", "evals", "eval-runner.mjs.template"), "utf8");
  const tasks = { tasks: [{ id: "doc-edit", kind: "dispatch", agent: "worker", prompt: "DO:WRITE:src/a.txt=ok", graders: [{ type: "fileContains", path: "src/a.txt", text: "ok" }] }] };
  const p = makeProject({ provider: { tiers: { light: "haiku", default: "sonnet" } }, files: { ".agent-team/evals/run.mjs": runner, ".agent-team/evals/tasks.json": JSON.stringify(tasks) } });
  const env = { ...process.env, HOME: p.home, USERPROFILE: p.home, FAKE_ARGV_LOG: p.argvLog };
  const r = spawnSync("node", [".agent-team/evals/run.mjs", "dispatch", "--yes", "--k", "1", "--tiers", "light,default"], { cwd: p.dir, encoding: "utf8", env, timeout: 180000 });
  assert.match(r.stdout, /1 task\(s\) x 2 tier\(s\) x 1 trial\(s\) = 2 real provider run\(s\) — tiers compared with escalation OFF: light vs default/);
  assert.match(r.stdout, /doc-edit\tlight\t100%/);
  assert.match(r.stdout, /doc-edit\tdefault\t100%/);
  assert.match(r.stdout, /per tier \(all tasks\)/);
  assert.match(r.stdout, /light\t1\/1 \(100%\)/);
  assert.deepEqual(modelsUsed(p).sort(), ["haiku", "sonnet"]);
  const file = fs.readdirSync(path.join(p.dir, ".agent-team", "evals")).find((f) => /light-vs-default/.test(f));
  assert.ok(file, "results file names the tiers compared");
});

test("tier: only clearly mechanical work is suggested for the light tier; anything sensitive or reasoning-heavy never is", () => {
  const p = makeProject();
  const tier = (s) => JSON.parse(run(p, ["tier", "--json", s]).out);
  for (const s of ["Rename printLog to printEventLog everywhere", "Fix a typo in the README", "Add a Glossary section to AGENTS.md", "Pin the light tier to a full model id in the config", "Add a test named 'x' to spec using makeProject"]) {
    assert.equal(tier(s).tier, "light", s);
  }
  for (const s of ["Rename the auth module", "Update the migration for the new column", "Implement tenant isolation for reports", "Investigate why the build is slow", "Fix the login bug", "Add the new endpoint", "Update the README to describe the permission model", "x ".repeat(300) + "rename a file"]) {
    assert.equal(tier(s).tier, "default", s);
  }
  assert.match(run(p, ["tier", "Fix a typo in the README"]).out, /^light \(effort low\) — mechanical edit/);
});

test("autoTier: an opted-in agent starts a clearly mechanical queue item on light; others, tagged items and sensitive items do not", () => {
  const status = "# Status\n\n## Queue\n- [ ] [worker] fix a typo in the README DO:WRITE:src/a.txt=1\n";
  const tiers = { light: "haiku", default: "sonnet", high: "opus" };
  const on = makeProject({ provider: { tiers }, agent: { autoTier: true }, files: { ".agent-team/STATUS.md": status } });
  run(on, ["run-phase"]);
  assert.deepEqual(modelsUsed(on), ["haiku"]);
  assert.ok(events(on).some((e) => e.type === "auto_tier" && e.tier === "light"));
  const off = makeProject({ provider: { tiers }, files: { ".agent-team/STATUS.md": status } });
  run(off, ["run-phase"]);
  assert.deepEqual(modelsUsed(off), [], "no tier on the agent and no autoTier: the CLI default, as before");
  const sens = makeProject({ provider: { tiers }, agent: { autoTier: true }, files: { ".agent-team/STATUS.md": "# Status\n\n## Queue\n- [ ] [worker] fix a typo in the auth module DO:WRITE:src/a.txt=1\n" } });
  run(sens, ["run-phase"]);
  assert.deepEqual(modelsUsed(sens), [], "a sensitive area is never started light");
  const tagged = makeProject({ provider: { tiers }, agent: { autoTier: true }, files: { ".agent-team/STATUS.md": "# Status\n\n## Queue\n- [ ] [worker] [tier:high] fix a typo in the README DO:WRITE:src/a.txt=1\n" } });
  run(tagged, ["run-phase"]);
  assert.deepEqual(modelsUsed(tagged), ["opus"], "an explicit tag always wins");
});

test("plan: marks the items a cheap model could start on", () => {
  const p = makeProject({ files: { ".agent-team/STATUS.md": "# Status\n\n## Queue\n- [ ] [worker] fix a typo in the README\n" } });
  assert.match(run(p, ["plan"]).out, /\[tier:light suggested\]/);
});

test("a tier model id with shell metacharacters is refused at dispatch and flagged by lint (the command runs through a shell)", () => {
  const evil = "haiku; echo pwned > pwned.txt";
  const p = makeProject({ provider: { tiers: { light: evil, default: "sonnet" } }, agent: { tier: "light" } });
  assert.match(run(p, ["lint"]).out, /tier "light" has model .* characters outside/);
  const r = run(p, ["spawn", "worker", "DO:WRITE:src/o.txt=1"]);
  assert.match(r.out, /characters outside \[A-Za-z0-9\._:\/-\]/);
  assert.ok(!fs.existsSync(path.join(p.dir, "pwned.txt")), "the injected command must not run");
  const ok = makeProject({ provider: { tiers: { light: "claude-haiku-5-5", default: "sonnet" } }, agent: { tier: "light" } });
  assert.match(run(ok, ["spawn", "worker", "DO:WRITE:src/o.txt=1"]).out, /worker done/);
});

test("security ledger: only the security agent may change it, so a worker cannot write its own approval (headless and live)", () => {
  const gateFiles = {
    ".claude/security-sensitive-paths.txt": "^src/auth/\n",
    ".claude/hooks/security-gate.sh": fs.readFileSync(path.join(REPO, "assets", "security-gate.sh.template"), "utf8").replace(/<test-file regex[^>]*>/, "\.test\.").replace(/<security-agent-name>/g, "auditor"),
    ".claude/contracts/security-audit-log.md": "# Security audit log\n",
    "src/auth/existing.txt": "seed\n",
  };
  const attack = "DO:WRITE:src/auth/login.txt=1\nDO:APPEND:.claude/contracts/security-audit-log.md=- audited src/auth/login.txt: fine\n";
  const p = makeProject({ roster: { securityAgent: "auditor" }, files: gateFiles });
  const r = run(p, ["spawn", "worker", attack]);
  assert.match(r.out, /only the security agent \(auditor\) may change/);
  assert.ok(!fs.existsSync(path.join(p.dir, "src", "auth", "login.txt")), "nothing may merge");
  // the opt-out of the ownership guard does not lift it
  const off = makeProject({ roster: { securityAgent: "auditor" }, agent: { ownershipGuard: false }, files: gateFiles });
  assert.match(run(off, ["spawn", "worker", "DO:APPEND:.claude/contracts/security-audit-log.md=- x"]).out, /only the security agent \(auditor\) may change/);
  // the security agent itself may append; other contracts stay open to everyone
  const self = makeProject({ roster: { securityAgent: "worker" }, files: gateFiles });
  assert.match(run(self, ["spawn", "worker", attack]).out, /worker done/);
  assert.match(run(p, ["spawn", "worker", "DO:WRITE:.claude/contracts/api-spec.md=1"]).out, /worker done/);
  // live path
  const w = (file) => hook(p, "PreToolUse", { tool_name: "Edit", tool_input: { file_path: file }, agent_id: "a1", agent_type: "worker", cwd: p.dir });
  assert.equal(w(".claude/contracts/security-audit-log.md").status, 2);
  assert.match(w(".claude/contracts/security-audit-log.md").out, /only be changed by the security agent \(auditor\)/);
  assert.equal(w(".claude/contracts/api-spec.md").status, 0);
});

test("test-tamper guard: statically disabled tests and unconditional skips count; conditional skips (the integration-test idiom) do not", () => {
  const counted = ["it.skip('x', () => {});", "it.todo('x');", "xit('x', () => {});", "it.skipIf(true)('x', () => {});", "test.skip();", "  ctx.skip();", "  t.Skip(\"later\")", "@pytest.mark.skip(reason='x')"];
  const fine = ["if (!db) return ctx.skip();", "test.skip(isCI, 'no db here');", "it.skipIf(!db)('x', () => {});", "it.runIf(db)('x', () => {});", "ctx.skip(!hasDb);", "@pytest.mark.skipif(not db)", "if testing.Short() { t.Skip(\"short\") }"];
  for (const line of counted) {
    const p = makeProject();
    assert.match(run(p, ["spawn", "worker", `DO:WRITE:tests/new.test.js=${line}`]).out, /skip\/disable marker/, line);
  }
  for (const line of fine) {
    const p = makeProject();
    assert.doesNotMatch(run(p, ["spawn", "worker", `DO:WRITE:tests/new.test.js=${line}`]).out, /skip\/disable marker/, line);
  }
});

test("hook SubagentStop: a skip already in the shared tree when the agent started is not blamed on it", () => {
  const p = makeProject({ files: { "tests/a.test.js": "test('a', () => {\n  expect(1).toBe(1);\n});\n" } });
  const tampered = () => events(p).filter((e) => e.type === "tamper_suspected").length;
  const ok = "CHECKS\n1. PASS — x — evidence: y\nUNVERIFIED: none";
  // somebody else's uncommitted edit: a disabled test, present before this agent starts
  fs.writeFileSync(path.join(p.dir, "tests", "a.test.js"), "test.skip('a', () => {\n  expect(1).toBe(1);\n});\n");
  const start = { agent_type: "worker", cwd: p.dir };
  hook(p, "SubagentStart", { ...start, agent_id: "late" });
  hook(p, "SubagentStop", { ...start, agent_id: "late", last_assistant_message: ok });
  assert.equal(tampered(), 0, "unchanged since the agent started");
  hook(p, "SubagentStart", { ...start, agent_id: "late2" });
  fs.appendFileSync(path.join(p.dir, "tests", "a.test.js"), "it.skip('b', () => {});\n");
  hook(p, "SubagentStop", { ...start, agent_id: "late2", last_assistant_message: ok });
  assert.equal(tampered(), 1, "a skip it added itself is still caught");
});

// ---- ownership fit, glob semantics, session limits ----
test("glob: `**/` means any number of directories including none, so root-level files match like in .gitignore", () => {
  const p = makeProject({ files: { "x.test.js": "test('x', () => { expect(1).toBe(1); });\n" } });
  // the default testPaths include **/*.test.*: a root-level test file must be guarded too
  assert.match(run(p, ["spawn", "worker", "DO:WRITE:x.test.js=test.skip('x', () => {});"]).out, /skip\/disable marker/);
});

test("lint: unowned files, dead ownership globs, double owners and test files outside testPaths are reported", () => {
  const p = makeProject({
    files: {
      "src/a.ts": "export const a = 1;\n",
      "next.config.ts": "export default {};\n",
      "api/types.ts": "export type T = 1;\n",
      "src/db.integration.tests.ts": "it('x', () => {});\n",
      "src/a.test.ts": "it('a', () => {});\n",
    },
  });
  const rp = path.join(p.dir, ".agent-team", "roster.json");
  const roster = JSON.parse(fs.readFileSync(rp, "utf8"));
  roster.agents[0].ownership = ["src/**", "nothing-here/**"];
  roster.agents.push({ ...roster.agents[0], name: "second", routing: ["second"], ownership: ["src/**"] });
  fs.writeFileSync(rp, JSON.stringify(roster));
  git(p.dir, "add", "-A");
  git(p.dir, "commit", "-qm", "files");
  const out = run(p, ["lint"]).out;
  assert.match(out, /\[info\] \d+ tracked file\(s\) are in no agent's ownership.*next\.config\.ts/);
  assert.match(out, /api\/types\.ts/);
  assert.match(out, /\[info\] agent worker: ownership "nothing-here\/\*\*" matches no tracked file/);
  assert.match(out, /\[warn\] .*owned by more than one agent/);
  assert.match(out, /\[warn\] 1 file\(s\) look like tests but match no testPaths \(src\/db\.integration\.tests\.ts\)/);
  setRoster(p, { sharedPaths: ["next.config.ts", "api/**", "fake.mjs"], testPaths: ["**/*.test.*", "**/*.tests.*"] });
  const fixed = run(p, ["lint"]).out;
  assert.doesNotMatch(fixed, /are in no agent's ownership|look like tests/);
});

test("usage: a session limit is reported as a stall with the output and commits of each window, and is not mistaken for work", () => {
  const p = makeProject();
  const t = path.join(p.home, "limits");
  fs.mkdirSync(path.join(t, "s1", "subagents"), { recursive: true });
  const msg = (id, ts, out, model = "claude-sonnet-5-5") => JSON.stringify({ type: "assistant", timestamp: ts, message: { id, model, usage: { output_tokens: out }, content: [{ type: "text", text: "ok" }] } });
  const limit = (ts) => JSON.stringify({ type: "assistant", timestamp: ts, isApiErrorMessage: true, error: "rate_limit", message: { id: "lim" + ts, model: "<synthetic>", usage: { output_tokens: 0 }, content: [{ type: "text", text: "You've hit your session limit · resets 3am (Asia/Kolkata)" }] } });
  fs.writeFileSync(
    path.join(t, "s1.jsonl"),
    [msg("a", "2026-03-01T10:00:00Z", 1000, "claude-opus-5-5"), msg("b", "2026-03-01T11:00:00Z", 500), limit("2026-03-01T11:05:00Z"), msg("c", "2026-03-01T13:00:00Z", 700), limit("2026-03-01T14:00:00Z"), msg("d", "2026-03-01T15:00:00Z", 100)].join("\n") + "\n",
  );
  // a subagent stopped by the same limit a minute later: one stall, not two
  fs.writeFileSync(path.join(t, "s1", "subagents", "agent-x.jsonl"), limit("2026-03-01T11:06:00Z") + "\n");
  fs.writeFileSync(path.join(t, "s1", "subagents", "agent-x.meta.json"), JSON.stringify({ agentType: "worker" }));
  const rep = JSON.parse(run(p, ["usage", "--json", "--transcripts", t]).out);
  assert.equal(rep.limits.hits, 3);
  assert.equal(rep.limits.stalls.length, 2, "the 11:05 and 11:06 hits end at the same moment: one stall");
  assert.equal(rep.limits.stalls[0].hits, 2);
  assert.equal(rep.limits.stalls[0].minutes, 115, "11:05 until the next real message at 13:00");
  assert.equal(rep.limits.stalls[0].resets, "3am (Asia/Kolkata)");
  assert.equal(rep.limits.stalls[1].minutes, 60);
  assert.equal(rep.limits.stalledMinutes, 175);
  assert.equal(rep.limits.periods.length, 3);
  assert.equal(rep.limits.periods[0].out, 1500);
  assert.equal(rep.limits.periods[0].byModel.opus, 1000);
  assert.ok(rep.flags.some((f) => /session limit hit 2 time\(s\)/.test(f)));
  assert.match(run(p, ["usage", "--transcripts", t]).out, /session limit: 2 stall\(s\)/);
  const w = rep.per.find((x) => x.agent === "worker");
  assert.equal(w.out, 0, "the synthetic limit message is not output");
});

test("usage: repeated blocked writes to one file say whether it has an owner", () => {
  const p = makeProject({ files: { "src/a.txt": "x\n" } });
  const t = path.join(p.home, "friction");
  fakeTranscripts(t, [{ id: "a", type: "worker", model: "claude-sonnet-5-5", out: 10, report: true }]);
  const rp = path.join(p.dir, ".agent-team", "roster.json");
  const roster = JSON.parse(fs.readFileSync(rp, "utf8"));
  roster.agents.push({ ...roster.agents[0], name: "web", routing: ["web"], ownership: ["web/**"] });
  fs.writeFileSync(rp, JSON.stringify(roster));
  const ev = (file, agent) => JSON.stringify({ ts: new Date().toISOString(), type: "ownership_violation", agent, file, policy: "enforce" });
  fs.appendFileSync(path.join(p.dir, ".agent-team", "events.jsonl"), [ev("next.config.ts", "worker"), ev(".claude/worktrees/agent-1/next.config.ts", "worker"), ev("web/page.tsx", "worker"), ev("web/page.tsx", "worker"), ev("once.ts", "worker")].join("\n") + "\n");
  const rep = JSON.parse(run(p, ["usage", "--json", "--transcripts", t]).out);
  assert.equal(rep.ownership.blocks, 5);
  assert.ok(rep.flags.some((f) => /next\.config\.ts: 2 blocked writes .* no agent owns it/.test(f)), "the worktree prefix is folded into the real path");
  assert.ok(rep.flags.some((f) => /web\/page\.tsx: 2 blocked writes .* belongs to web/.test(f)));
  assert.ok(!rep.flags.some((f) => /once\.ts/.test(f)), "a single block is not a pattern");
});

test("usage --days: the main-session figure covers the same window as the subagent total", () => {
  const p = makeProject();
  const t = path.join(p.home, "window");
  fs.mkdirSync(t, { recursive: true });
  const msg = (id, ts, out) => JSON.stringify({ type: "assistant", timestamp: ts, message: { id, model: "claude-opus-5-5", usage: { output_tokens: out }, content: [{ type: "text", text: "ok" }] } });
  const recent = new Date(Date.now() - 3600e3).toISOString();
  fs.writeFileSync(path.join(t, "s1.jsonl"), [msg("old", "2020-01-01T00:00:00Z", 5000), msg("new", recent, 70)].join("\n") + "\n");
  assert.equal(JSON.parse(run(p, ["usage", "--json", "--days", "2", "--transcripts", t]).out).mainOut.out, 70);
  assert.equal(JSON.parse(run(p, ["usage", "--json", "--transcripts", t]).out).mainOut.out, 5070, "no window: everything");
});

// ---- audit patterns: repeated same-shape work is audited in full once, then light ----
const HANDLER = (m) => `export async function ${m}(req) {\n  const s = await session(req);\n  return ok(s);\n}\n`;
const WRAPPED = (m, body = "return ok(s);") => `import { wrap } from "./wrap";\nexport const ${m} = wrap("${m}", async (req) => {\n    const s = await session(req);\n    ${body}\n});\n`;
const ROUTE_PATTERN = { name: "route-wrapper", match: String.raw`^\s*(import \{ wrap \}|export const (GET|POST) = wrap\(|export async function (GET|POST)\()`, coverage: "route-coverage test" };
function patternProject() {
  const p = riskProject();
  writeFile(p, "src/auth/h1.ts", HANDLER("GET"));
  writeFile(p, "src/auth/h2.ts", HANDLER("POST"));
  git(p.dir, "add", "-A");
  git(p.dir, "commit", "-q", "-m", "handlers");
  setRoster(p, { auditPatterns: [ROUTE_PATTERN] });
  return p;
}
const ledger = (p, text) => {
  fs.mkdirSync(path.join(p.dir, ".claude", "contracts"), { recursive: true });
  fs.writeFileSync(path.join(p.dir, ".claude", "contracts", "security-audit-log.md"), text);
};

test("risk: a declared pattern is a full audit the first time and light once a full audit of it is on record", () => {
  const p = patternProject();
  writeFile(p, "src/auth/h1.ts", WRAPPED("GET"));
  writeFile(p, "src/auth/h2.ts", WRAPPED("POST"));
  let rep = riskOf(p);
  const h1 = rep.files.find((f) => f.file === "src/auth/h1.ts");
  assert.equal(h1.cls, "pattern", "re-indentation and the wrapper are the only changes");
  assert.equal(h1.seen, false);
  assert.equal(rep.depth, "full", "first use");
  assert.match(rep.advice, /First use of pattern "route-wrapper".*pattern: route-wrapper/);
  ledger(p, "## 2026-01-01 — Full audit: batch 1\nVerdict: ok. pattern: route-wrapper verified with git diff -w.\n");
  rep = riskOf(p);
  assert.equal(rep.depth, "light");
  assert.equal(rep.files.find((f) => f.file === "src/auth/h2.ts").seen, true);
  assert.match(rep.advice, /already-audited pattern "route-wrapper".*route-coverage test.*do not hunt/);
});

test("risk: one logic line next to the pattern, or a pattern that is not declared, keeps the file at full audit", () => {
  const p = patternProject();
  ledger(p, "pattern: route-wrapper\n");
  writeFile(p, "src/auth/h1.ts", WRAPPED("GET", "return ok(s.user);")); // the body changed as well
  writeFile(p, "src/auth/h2.ts", WRAPPED("POST"));
  let rep = riskOf(p);
  assert.equal(rep.files.find((f) => f.file === "src/auth/h1.ts").cls, "logic");
  assert.equal(rep.files.find((f) => f.file === "src/auth/h2.ts").cls, "pattern");
  assert.equal(rep.depth, "full");
  setRoster(p, { auditPatterns: [] });
  assert.equal(riskOf(p).files.find((f) => f.file === "src/auth/h2.ts").cls, "logic", "no declared pattern: nothing is exempt");
});

test("lint: auditPatterns need a name and a valid regex, and say what proves the pattern was followed", () => {
  const p = makeProject();
  setRoster(p, { auditPatterns: [{ name: "a", match: "(" }, { match: "x" }, { name: "ok", match: "^wrapper\(" }] });
  const out = run(p, ["lint"]).out;
  assert.match(out, /\[error\] auditPatterns\[0\] \("a"\): "match" is not a valid regex/);
  assert.match(out, /\[error\] auditPatterns\[1\] needs a string "name"/);
  assert.match(out, /\[warn\] auditPatterns "ok" has no "coverage"/);
  setRoster(p, { auditPatterns: [{ name: "wide", match: ".*", coverage: "x" }] });
  assert.match(run(p, ["lint"]).out, /"wide": the match regex looks too loose/);
});

test("usage: repeated same-shape audits are flagged while recent, with the way out; a declared pattern, or finished batches, silence it", () => {
  const p = makeProject();
  setRoster(p, { securityAgent: "worker" });
  const t = path.join(p.home, "shapes");
  fakeTranscripts(t, [{ id: "a", type: "worker", model: "claude-sonnet-5-5", out: 10, report: true }]);
  const day = (ago) => new Date(Date.now() - ago * 86400000).toISOString().slice(0, 10);
  ledger(p, [1, 2, 3, 4].map((n) => `## ${day(5 - n)} — Full audit round 1: route batch ${n} (ADR 52: ${n * 10} handlers)\nVerdict: ok\n`).join("\n"));
  const shape = (...extra) => JSON.parse(run(p, ["usage", "--json", "--transcripts", t, ...extra]).out).flags.filter((f) => /share one shape/.test(f));
  const flagged = shape();
  assert.equal(flagged.length, 1);
  assert.match(flagged[0], /4 audit entries share one shape \("Full audit round 1: route batch 1"\).*auditPatterns/);
  assert.equal(shape("--days", "1").length, 0, "batches older than the window are history, not a suggestion");
  ledger(p, [1, 2, 3, 4].map((n) => `## ${day(30 - n)} — Full audit round 1: route batch ${n} (ADR 52)\nVerdict: ok\n`).join("\n"));
  assert.equal(shape().length, 0, "no --days: only the last 14 days count");
  ledger(p, [1, 2, 3, 4].map((n) => `## ${day(5 - n)} — Full audit round 1: route batch ${n} (ADR 52)\nVerdict: ok\n`).join("\n"));
  setRoster(p, { securityAgent: "worker", auditPatterns: [ROUTE_PATTERN] });
  assert.equal(shape().length, 0);
});

test("usage: a run of audits of DIFFERENT slices is not an audit loop; re-audits chained back to back are", () => {
  const p = makeProject({ roster: { securityAgent: "worker" } });
  const chain = (name, prompts) => {
    const t = path.join(p.home, name);
    fakeTranscripts(t, prompts.map((prompt, i) => ({ id: name + i, type: "worker", model: "claude-opus-5-5", out: 10, report: true, prompt })));
    return JSON.parse(run(p, ["usage", "--json", "--transcripts", t]).out).flags.filter((f) => /audit chain/.test(f));
  };
  assert.equal(chain("slices", ["Full audit round 1: slice 1", "Full audit round 1: slice 2", "Full audit round 1: slice 3", "Full audit round 1: slice 4"]).length, 0);
  const loop = chain("loop2", ["Full audit round 1: slice 1", "Re-audit round 2 of the fix", "Re-audit of the second fix", "Full audit round 1: slice 2"]);
  assert.equal(loop.length, 1);
  assert.match(loop[0], /1 audit chain\(s\) of 3\+ back-to-back runs \(longest 4\) with two re-audits in a row/);
});

// ---- token economy: what a run costs is turns x context, so measure it and tell agents ----
test("hook SubagentStart: a working-economy note rides with the digest; economyHint false, turnBudget and the A/B switch control it", () => {
  const p = makeProject();
  const ctxOf = (env = {}) => {
    const out = hook(p, "SubagentStart", { agent_type: "worker", agent_id: "e" + Math.random() }, env).out;
    return out.trim() ? JSON.parse(out).hookSpecificOutput.additionalContext : "";
  };
  let ctx = ctxOf();
  assert.match(ctx, /## Working economy/);
  assert.match(ctx, /SAME turn/);
  assert.match(ctx, /about 60 turns/, "default budget");
  setRoster(p, { turnBudget: 25 });
  assert.match(ctxOf(), /about 25 turns/);
  setRoster(p, { turnBudget: 0 });
  ctx = ctxOf();
  assert.match(ctx, /Working economy/);
  assert.doesNotMatch(ctx, /turns\. If the task is bigger/, "0 drops the budget line only");
  setRoster(p, { turnBudget: 60, economyHint: false });
  assert.doesNotMatch(ctxOf(), /Working economy/);
  assert.match(ctxOf(), /Your playbook/, "the playbook digest is unaffected");
  setRoster(p, { economyHint: true });
  assert.equal(ctxOf({ AGENT_TEAM_NO_PLAYBOOK: "1" }), "", "the A/B switch removes the orchestrator's guidance, hint included");
});

function economyTranscripts(root, { runs, turns, batched }) {
  const sub = path.join(root, "sess1", "subagents");
  fs.mkdirSync(sub, { recursive: true });
  for (let r = 0; r < runs; r++) {
    const lines = [];
    for (let t = 0; t < turns; t++) {
      const ctx = 40000 + t * 1000; // context grows by 1k per turn
      const calls = batched && t % 2 === 0 ? 2 : 1;
      const content = Array.from({ length: calls }, (_, i) => ({ type: "tool_use", id: `r${r}t${t}c${i}`, name: "Bash", input: { command: "ls" } }));
      lines.push(JSON.stringify({ type: "assistant", timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, t)).toISOString(), message: { id: `r${r}t${t}`, model: "claude-sonnet-5-5", usage: { input_tokens: 10, cache_read_input_tokens: ctx - 10 - 500, cache_creation_input_tokens: 500, output_tokens: 20 }, content } }));
    }
    fs.writeFileSync(path.join(sub, `agent-r${r}.jsonl`), lines.join("\n") + "\n");
    fs.writeFileSync(path.join(sub, `agent-r${r}.meta.json`), JSON.stringify({ agentType: "worker" }));
  }
  fs.writeFileSync(path.join(root, "sess1.jsonl"), "");
}

test("usage: context cost is measured per run, and single-call turns and long runs are flagged with the way out", () => {
  const p = makeProject();
  const t = path.join(p.home, "economy");
  economyTranscripts(t, { runs: 2, turns: 100, batched: false });
  const rep = JSON.parse(run(p, ["usage", "--json", "--transcripts", t]).out);
  const c = rep.context;
  assert.equal(c.turns, 200);
  assert.equal(c.coldStartAvg, 40000, "the first turn's context");
  assert.equal(c.avgContext, 40000 + 49500, "average of 40k..139k");
  assert.equal(c.singleCallPct, 100);
  assert.equal(c.longRuns, 2);
  assert.equal(c.longRunCacheReadPct, 100);
  assert.equal(c.cacheReadPerOutput, Math.round(c.cacheRead / c.output));
  assert.ok(rep.flags.some((f) => /100% of 200 tool turns made a single call/.test(f) && /economyHint/.test(f)));
  assert.ok(rep.flags.some((f) => /2 runs over 80 turns used 100% of all cache reads/.test(f)));
  const w = rep.per.find((x) => x.agent === "worker");
  assert.equal(w.cacheRead, c.cacheRead);
  assert.match(run(p, ["usage", "--transcripts", t]).out, /context: .* read from cache for .*100% of tool turns made a single call; 2 run\(s\) over 80 turns/);
});

test("usage: batched calls and short runs raise no context flag", () => {
  const p = makeProject();
  const t = path.join(p.home, "economy2");
  economyTranscripts(t, { runs: 6, turns: 40, batched: true });
  const rep = JSON.parse(run(p, ["usage", "--json", "--transcripts", t]).out);
  assert.equal(rep.context.singleCallPct, 50);
  assert.equal(rep.context.longRuns, 0);
  assert.ok(!rep.flags.some((f) => /single call|runs over 80 turns/.test(f)));
});

// ---- routing: effort first, then a bigger model; routes; memory; cost per solved change ----
const argvValues = (p, flag) =>
  fs.existsSync(p.argvLog)
    ? fs.readFileSync(p.argvLog, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((a) => !a.includes("--advice") && a.includes(flag)).map((a) => a[a.indexOf(flag) + 1])
    : [];
const EFFORT_PROVIDER = { tiers: { light: "haiku", default: "sonnet", high: "opus" }, effortFlag: "--effort", tierEfforts: { light: "low", default: "medium", high: "high" } };

test("effort ladder: a failed check retries with more effort on the same model first, then a bigger model; --no-escalate and escalateEffortFirst:false pin or flatten it", () => {
  const failing = { selfVerification: "false" };
  const a = makeProject({ provider: EFFORT_PROVIDER, agent: failing });
  run(a, ["spawn", "worker", "DO:WRITE:src/a.txt=1", "--tier", "light"]);
  assert.deepEqual(argvValues(a, "--model"), ["haiku", "haiku", "sonnet"]);
  assert.deepEqual(argvValues(a, "--effort"), ["low", "medium", "medium"], "low -> medium on the cheap model, then the next tier at its own default");
  const b = makeProject({ provider: EFFORT_PROVIDER, agent: failing });
  run(b, ["spawn", "worker", "DO:WRITE:src/a.txt=1", "--tier", "default", "--effort", "high"]);
  assert.deepEqual(argvValues(b, "--model"), ["sonnet", "sonnet", "opus"]);
  assert.deepEqual(argvValues(b, "--effort"), ["high", "xhigh", "high"]);
  const c = makeProject({ provider: EFFORT_PROVIDER, agent: failing });
  run(c, ["spawn", "worker", "DO:WRITE:src/a.txt=1", "--tier", "light", "--no-escalate"]);
  assert.deepEqual(argvValues(c, "--model"), ["haiku", "haiku", "haiku"]);
  assert.deepEqual(argvValues(c, "--effort"), ["low", "low", "low"], "a fair comparison pins both axes");
  const d = makeProject({ provider: EFFORT_PROVIDER, agent: failing, roster: { escalateEffortFirst: false } });
  run(d, ["spawn", "worker", "DO:WRITE:src/a.txt=1", "--tier", "light"]);
  assert.deepEqual(argvValues(d, "--model"), ["haiku", "sonnet", "opus"], "tier-only escalation, as before");
  assert.deepEqual(argvValues(d, "--effort"), ["low", "medium", "high"], "each tier at its own default effort");
  const e = makeProject({ provider: { tiers: EFFORT_PROVIDER.tiers }, agent: failing });
  run(e, ["spawn", "worker", "DO:WRITE:src/a.txt=1", "--tier", "light"]);
  assert.deepEqual(argvValues(e, "--effort"), [], "no effortFlag on the provider: no effort is passed, tier-only steps");
  assert.deepEqual(argvValues(e, "--model"), ["haiku", "sonnet", "opus"]);
  assert.match(run(a, ["spawn", "worker", "x", "--effort", "turbo"]).out, /--effort must be one of low, medium, high, xhigh, max/);
});

test("effort: an agent's own effort and a queue item's [effort:x] set the starting effort; the tag is not sent to the worker", () => {
  const status = "# Status\n\n## Queue\n- [ ] [worker] [tier:default] [effort:xhigh] DO:WRITE:src/a.txt=1\n";
  const p = makeProject({ provider: EFFORT_PROVIDER, agent: { effort: "low" }, files: { ".agent-team/STATUS.md": status } });
  run(p, ["run-phase"]);
  assert.deepEqual(argvValues(p, "--effort"), ["xhigh"], "the task's tag beats the agent's effort");
  assert.equal(fs.readFileSync(path.join(p.dir, "src", "a.txt"), "utf8").trim(), "1", "the worker still got the directive without the tag");
  const q = makeProject({ provider: EFFORT_PROVIDER, agent: { effort: "high" }, files: { ".agent-team/STATUS.md": "# Status\n\n## Queue\n- [ ] [worker] DO:WRITE:src/a.txt=1\n" } });
  run(q, ["run-phase"]);
  assert.deepEqual(argvValues(q, "--effort"), ["high"]);
});

test("autoTier starts a mechanical item on the cheap tier at LOW effort", () => {
  const p = makeProject({ provider: EFFORT_PROVIDER, agent: { autoTier: true }, files: { ".agent-team/STATUS.md": "# Status\n\n## Queue\n- [ ] [worker] fix a typo in the README DO:WRITE:src/a.txt=1\n" } });
  run(p, ["run-phase"]);
  assert.deepEqual(argvValues(p, "--model"), ["haiku"]);
  assert.deepEqual(argvValues(p, "--effort"), ["low"]);
});

test("dispatch_end records the effort of each attempt and a short task head, for routing memory and usage", () => {
  const p = makeProject({ provider: EFFORT_PROVIDER, agent: { selfVerification: "false" } });
  run(p, ["spawn", "worker", "DO:WRITE:src/a.txt=1", "--tier", "light"]);
  const end = events(p).find((e) => e.type === "dispatch_end");
  assert.deepEqual(end.efforts, ["low", "medium", "medium"]);
  assert.equal(end.startTier, "light");
  assert.ok(Array.isArray(end.taskWords) && end.taskWords.length > 0 && end.taskWords.every((h) => /^[0-9a-f]{8}$/.test(h)), "keywords, hashed");
  assert.doesNotMatch(JSON.stringify(end), /DO:WRITE|src\/a\.txt/, "no task text in the log");
});

test("tier: suggests an effort; routing memory raises the start for tasks that resemble ones that needed escalating, never lowers it", () => {
  const p = makeProject();
  const tier = (s) => JSON.parse(run(p, ["tier", "--json", s]).out);
  assert.equal(tier("Rename printLog everywhere").effort, "low");
  assert.equal(tier("Update the migration for the new column").effort, "high");
  assert.equal(tier("Implement the new report").effort, "medium");
const hashes = (t) => [...new Set(t.toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g) || [])].map((w) => createHash("sha1").update(w).digest("hex").slice(0, 8));
  const end = (taskHead, over = {}) => JSON.stringify({ ts: new Date().toISOString(), type: "dispatch_end", agent: "worker", tiersTried: ["light", "default"], efforts: ["low", "medium"], startTier: "light", attempts: 2, pass: true, taskWords: hashes(taskHead), ...over });
  const evp = path.join(p.dir, ".agent-team", "events.jsonl");
  fs.writeFileSync(evp, [end("Rename widget helper functions in the billing module"), end("Rename widget helper functions in the invoice module")].join("\n") + "\n");
  assert.equal(tier("Rename the widget helper functions").tier, "default", "two similar tasks both needed the next tier");
  assert.match(run(p, ["tier", "Rename the widget helper functions"]).out, /^default \(effort medium\) — 2 of 2 similar past tasks needed escalating.*the rules alone said light/);
  fs.writeFileSync(evp, end("Rename widget helper functions in the billing module") + "\n");
  assert.equal(tier("Rename the widget helper functions").tier, "light", "one data point is not a pattern");
  fs.writeFileSync(evp, [end("Rename widget helper functions", { attempts: 1, tiersTried: ["light"], efforts: ["low"] }), end("Rename widget helper functions again", { attempts: 1, tiersTried: ["light"], efforts: ["low"] })].join("\n") + "\n");
  assert.equal(tier("Rename the widget helper functions").tier, "light", "tasks that passed first time change nothing");
  fs.writeFileSync(evp, [end("Rename widget helper functions"), end("Rename widget helper functions now")].join("\n") + "\n");
  assert.equal(tier("Fix the unrelated deployment pipeline").tier, "default", "dissimilar tasks are ignored");
});

test("autoTier does not start cheap on a task that resembles ones that needed escalating", () => {
  const p = makeProject({ provider: EFFORT_PROVIDER, agent: { autoTier: true }, files: { ".agent-team/STATUS.md": "# Status\n\n## Queue\n- [ ] [worker] Rename widget helper functions DO:WRITE:src/a.txt=1\n" } });
const hashes = (t) => [...new Set(t.toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g) || [])].map((w) => createHash("sha1").update(w).digest("hex").slice(0, 8));
  const end = (h) => JSON.stringify({ ts: new Date().toISOString(), type: "dispatch_end", agent: "worker", tiersTried: ["light", "default"], efforts: ["low", "medium"], startTier: "light", attempts: 2, pass: true, taskWords: hashes(h) });
  fs.writeFileSync(path.join(p.dir, ".agent-team", "events.jsonl"), [end("Rename widget helper functions in billing"), end("Rename widget helper functions in invoices")].join("\n") + "\n");
  run(p, ["run-phase"]);
  assert.deepEqual(argvValues(p, "--model"), [], "no cheap start: the agent's own default");
  assert.ok(events(p).some((e) => e.type === "auto_tier_skipped"));
});

test("risk: names the route an audit of that depth needs (middle tier at medium effort for light, top tier at high for full)", () => {
  const p = riskProject();
  writeFile(p, "src/auth/a.ts", "import { x } from '@new/x';\nexport const a = x + 1;\n");
  assert.deepEqual(riskOf(p).route, { tier: "default", effort: "medium" });
  assert.match(run(p, ["risk"]).out, /suggested route: tier default, effort medium/);
  writeFile(p, "src/auth/e.ts", "import { s, t } from '@old/s';\nexport function check(u) { return s(u) && t(u); }\n");
  assert.deepEqual(riskOf(p).route, { tier: "high", effort: "high" });
  const clean = riskProject();
  assert.equal(riskOf(clean).route, null);
});

test("lint: effort values and the provider's effortFlag / tierEfforts are checked", () => {
  const p = makeProject({ provider: { effortFlag: "--effort", tierEfforts: { light: "low", default: "turbo" } }, agent: { effort: "extreme" } });
  const out = run(p, ["lint"]).out;
  assert.match(out, /\[error\] agent worker: effort "extreme" is not one of/);
  assert.match(out, /\[error\] providers\.json: provider "fake" tierEfforts\.default is "turbo"/);
  const q = makeProject({ provider: { tierEfforts: { light: "low" } }, agent: { effort: "high" } });
  const out2 = run(q, ["lint"]).out;
  assert.match(out2, /\[warn\] providers\.json: provider "fake" has tierEfforts but no effortFlag/);
  assert.match(out2, /\[info\] agent worker: effort is set but provider "fake" has no effortFlag/);
});

test("usage: cost per commit in relative units, by model and agent; verification-heavy spend and headless escalation rate are reported", () => {
  const p = makeProject({ roster: { securityAgent: "worker" } });
  const t = path.join(p.home, "cost");
  economyTranscripts(t, { runs: 2, turns: 10, batched: false });
  const evp = path.join(p.dir, ".agent-team", "events.jsonl");
  const end = (attempts, startTier) => JSON.stringify({ ts: new Date().toISOString(), type: "dispatch_end", agent: "worker", tiersTried: ["light"], efforts: ["low"], startTier, attempts, pass: true, taskHead: "x" });
  fs.writeFileSync(evp, [end(1, "light"), end(2, "light"), end(1, "default"), end(1, "default")].join("\n") + "\n");
  const rep = JSON.parse(run(p, ["usage", "--json", "--transcripts", t]).out);
  assert.equal(rep.cost.assumed, true);
  assert.ok(rep.cost.units > 0);
  assert.deepEqual(rep.cost.byModelPct, { sonnet: 100 });
  assert.ok(rep.cost.commits >= 1 && rep.cost.perCommit > 0, JSON.stringify(rep.cost));
  assert.equal(rep.cost.verificationShare, 100);
  assert.ok(rep.flags.some((f) => /worker is 100% of the cost.*checker/.test(f)));
  assert.equal(rep.routing.dispatches, 4);
  assert.equal(rep.routing.escalationRatePct, 25);
  assert.deepEqual(rep.routing.byStartTier.light, { dispatches: 2, escalated: 1 });
  assert.match(run(p, ["usage", "--transcripts", t]).out, /cost: .* units \(assumed price weights.*per commit.*verification 100%/);
  assert.match(run(p, ["usage", "--transcripts", t]).out, /headless routing: 4 dispatch\(es\), 25% needed escalating; by start tier light 1\/2, default 0\/2/);
  // the weights are the project's to set: opus counts for more than sonnet, haiku for less
  setRoster(p, { costWeights: { models: { sonnet: 3 } } });
  const heavier = JSON.parse(run(p, ["usage", "--json", "--transcripts", t]).out);
  assert.ok(Math.abs(heavier.cost.units / rep.cost.units - 3) < 0.01, "the sonnet multiplier scales the total");
});
