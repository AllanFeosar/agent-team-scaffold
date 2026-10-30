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

test("lint: a real command containing a redirect is not mistaken for a template placeholder (found testing on a real project)", () => {
  const p = makeProject({ agent: { selfVerification: "docker compose config --quiet && bunx turbo run typecheck --dry=json > /dev/null" } });
  assert.doesNotMatch(run(p, ["lint"]).out, /selfVerification is empty or still a template placeholder/);
  const q = makeProject({ agent: { selfVerification: "<the exact command from agent.md>" } });
  assert.match(run(q, ["lint"]).out, /selfVerification is empty or still a template placeholder/);
});

test("routing: an untagged queue item matching two agents is blocked, not given to whichever is first (found testing on a real roster)", () => {
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
  const p = makeProject({ agent: { routing: ["tenant-isolation"] }, files: { ".agent-team/STATUS.md": "# Status\n\n## Queue\n- [ ] write the tenant isolation suite DO:WRITE:src/t.txt=1\n" } });
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
  const bad = run(p, ["spawn", "worker", "DO:WRITE:src/ok.txt=1\nDO:WRITE:package.json={}\nDO:WRITE:bun.lock=x"]);
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

test("seal: the gate's own circuit-breaker state files inside .claude/hooks are not tampering (emr-platform SAL-L4)", () => {
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
