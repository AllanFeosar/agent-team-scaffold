// Behavioural tests for the eval runner (assets/evals/eval-runner.mjs.template): fake provider, no network, no tokens.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const git = (cwd, ...a) => spawnSync("git", a, { cwd, encoding: "utf8" }).stdout.trim();

function makeEvalProject(tasks, { routing = ["work"] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atevals-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "atevals-home-"));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "t");
  git(dir, "config", "core.autocrlf", "false");
  const put = (rel, content) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };
  put(".gitignore", ".agent-team/worktrees/\n.agent-team/events.jsonl\n.agent-team/evals/results-*\n");
  fs.copyFileSync(path.join(HERE, "fake-provider.mjs"), path.join(dir, "fake.mjs"));
  fs.mkdirSync(path.join(dir, ".agent-team", "evals"), { recursive: true });
  fs.copyFileSync(path.join(REPO, "assets", "orchestrator.mjs.template"), path.join(dir, ".agent-team", "orchestrator.mjs"));
  fs.copyFileSync(path.join(REPO, "assets", "evals", "eval-runner.mjs.template"), path.join(dir, ".agent-team", "evals", "run.mjs"));
  put(".agent-team/providers.json", JSON.stringify({ fake: { command: "node", args: ["fake.mjs"], adviceArgs: ["fake.mjs", "--advice"], modelFlag: "--model", tiers: { light: "haiku", default: "sonnet", high: "opus" } } }));
  put(".agent-team/roster.json", JSON.stringify({ agents: [{ name: "worker", provider: "fake", ownership: ["src/**"], selfVerification: "true", routing, worktree: true }] }));
  put(".agent-team/tentacles/worker/CONTEXT.md", "# Worker\n\nFixture.\n");
  put(".claude/agents/worker.md", "---\nname: worker\ndescription: fixture\n---\n# worker\n");
  put(".agent-team/STATUS.md", "# Status\n\n## Queue\n");
  put(".agent-team/evals/tasks.json", JSON.stringify({ tasks }));
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "init");
  return { dir, home, argvLog: path.join(home, "argv.log") };
}

function runner(p, args) {
  const r = spawnSync("node", [path.join(p.dir, ".agent-team", "evals", "run.mjs"), ...args], {
    cwd: p.dir,
    encoding: "utf8",
    env: { ...process.env, HOME: p.home, USERPROFILE: p.home, FAKE_ARGV_LOG: p.argvLog },
    timeout: 180000,
  });
  return { status: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

const results = (p) => {
  const d = path.join(p.dir, ".agent-team", "evals");
  const f = fs.readdirSync(d).find((x) => x.startsWith("results-"));
  return f ? JSON.parse(fs.readFileSync(path.join(d, f), "utf8")) : null;
};

const dispatchTask = (id, directive, graders) => ({ id, kind: "dispatch", agent: "worker", prompt: directive, graders });

test("dispatch evals refuse to spend tokens without --yes, and refuse on a dirty tree", () => {
  const p = makeEvalProject([dispatchTask("t1", "DO:WRITE:src/a.txt=hi", [{ type: "fileContains", path: "src/a.txt", text: "hi" }])]);
  const no = runner(p, ["dispatch", "--k", "1"]);
  assert.equal(no.status, 1);
  assert.match(no.out, /Refusing to start without --yes/);
  assert.equal(results(p), null);
  fs.appendFileSync(path.join(p.dir, ".gitignore"), "# change\n");
  const dirty = runner(p, ["dispatch", "--yes", "--k", "1"]);
  assert.equal(dirty.status, 1);
  assert.match(dirty.out, /working tree is not clean/);
});

test("dispatch evals grade the worker's output: a satisfied grader passes, an unsatisfied one fails", () => {
  const p = makeEvalProject([
    dispatchTask("good", "DO:WRITE:src/a.txt=hello", [{ type: "fileContains", path: "src/a.txt", text: "hello" }, { type: "diffTouchesOnly", globs: ["src/**"] }]),
    dispatchTask("bad", "DO:WRITE:src/b.txt=nope", [{ type: "fileContains", path: "src/b.txt", text: "expected-text" }]),
  ]);
  const r = runner(p, ["dispatch", "--yes", "--k", "1"]);
  assert.equal(r.status, 0, r.out);
  const res = results(p);
  const by = Object.fromEntries(res.summary.map((s) => [s.id, s]));
  assert.equal(by.good.passes, 1);
  assert.equal(by.bad.passes, 0);
  assert.match(by.bad.trials[0].failures[0], /fileContains/);
  assert.deepEqual(by.good.trials[0].changedFiles, ["src/a.txt"]);
  assert.match(r.out, /^good\t100%\tyes\tyes\t/m, "the original column layout is kept when no tiers are compared");
  assert.equal(git(p.dir, "worktree", "list").split("\n").length, 1, "trial worktrees are removed");
});

test("a grader that is violated by the result fails the trial (scope and file-count graders)", () => {
  const p = makeEvalProject([
    dispatchTask("scope", "DO:WRITE:src/a.txt=1\nDO:WRITE:docs/x.txt=2", [{ type: "diffTouchesOnly", globs: ["src/**"] }]),
    dispatchTask("count", "DO:WRITE:src/a.txt=1\nDO:WRITE:src/b.txt=2", [{ type: "diffMaxFiles", n: 1 }]),
    dispatchTask("unknown", "DO:WRITE:src/a.txt=1", [{ type: "nonsense" }]),
  ]);
  runner(p, ["dispatch", "--yes", "--k", "1"]);
  for (const s of results(p).summary) assert.equal(s.passes, 0, `${s.id} should fail`);
});

test("--tiers runs every task once per tier on that tier's model with escalation off, and reports each tier", () => {
  const p = makeEvalProject([dispatchTask("t1", "DO:WRITE:src/a.txt=hi", [{ type: "fileContains", path: "src/a.txt", text: "hi" }])]);
  const r = runner(p, ["dispatch", "--yes", "--k", "2", "--tiers", "light,default"]);
  assert.equal(r.status, 0, r.out);
  const res = results(p);
  assert.deepEqual(res.tiers, ["light", "default"]);
  assert.deepEqual(res.summary.map((s) => [s.id, s.tier, s.passes, s.k]), [["t1", "light", 2, 2], ["t1", "default", 2, 2]]);
  const models = fs.readFileSync(p.argvLog, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((a) => a.includes("--model")).map((a) => a[a.indexOf("--model") + 1]);
  assert.deepEqual(models.sort(), ["haiku", "haiku", "sonnet", "sonnet"]);
  assert.match(r.out, /^light\t2\/2 \(100%\)\t/m);
  assert.match(r.out, /^default\t2\/2 \(100%\)\t/m);
  assert.match(r.out, /hint, not a verdict/);
});

test("--tiers: a failing cheap run is NOT retried on a bigger model (escalation is off)", () => {
  const p = makeEvalProject([dispatchTask("t1", "DO:FAIL", [{ type: "fileContains", path: "src/a.txt", text: "x" }])]);
  runner(p, ["dispatch", "--yes", "--k", "1", "--tiers", "light"]);
  const models = fs.readFileSync(p.argvLog, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((a) => a.includes("--model")).map((a) => a[a.indexOf("--model") + 1]);
  assert.ok(models.length > 0 && models.every((m) => m === "haiku"), `models used: ${models}`);
  assert.equal(results(p).summary[0].passes, 0);
});

test("route evals: pass on the expected agent, fail on overlap or a miss", () => {
  const ok = makeEvalProject([{ id: "r1", kind: "route", prompt: "please do some work", expectAgent: "worker" }, { id: "r2", kind: "route", prompt: "unrelated", expectAgent: null }]);
  const a = runner(ok, ["route"]);
  assert.equal(a.status, 0, a.out);
  assert.match(a.out, /all route tasks passed/);
  const bad = makeEvalProject([{ id: "r1", kind: "route", prompt: "totally different", expectAgent: "worker" }]);
  const b = runner(bad, ["route"]);
  assert.equal(b.status, 1);
  assert.match(b.out, /FAIL {2}r1/);
});

test("compare prints the pass-rate delta between two result files", () => {
  const p = makeEvalProject([]);
  const mk = (name, passAt1) => {
    const f = path.join(p.home, name);
    fs.writeFileSync(f, JSON.stringify({ baseline: name.startsWith("b"), summary: [{ id: "t1", passAt1, meanSeconds: 5 }] }));
    return f;
  };
  const r = runner(p, ["compare", mk("a.json", 0.5), mk("b.json", 1)]);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /t1\t50%\t100%\t50 pts/);
});
