// Guards the rule in AGENTS.md: this repo is the generic scaffold and must contain nothing that
// identifies a consuming project. It scans every tracked file.
//
// The built-in patterns are assembled from pieces so that this file does not itself contain the strings
// it forbids. Names that must not appear even here go in a local, gitignored `.private-terms` file
// (one regular expression per line, `#` for comments); it is read if present.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const j = (...parts) => parts.join("");

// Known consumer identifiers and the domain vocabulary that gives a consumer away.
const BUILTIN = [
  j("e", "mr-platform"),
  j("\\bE", "MR\\b"),
  j("hos", "pital"),
  j("pa", "tient"),
  j("Dha", "thri"),
  j("NAB", "IDH"),
  j("Mal", "affi"),
  j("Riay", "ati"),
  j("NPH", "IES"),
  j("\\bSAL-[A-Z]", "\\d"),
  j("\\bS3[PR]", "-[A-Z]\\d"),
  j("with", "Tenant"),
  j("e", "mr_app"),
].map((p) => new RegExp(p, "i"));

function localTerms() {
  const f = path.join(REPO, ".private-terms");
  if (!fs.existsSync(f)) return [];
  return fs
    .readFileSync(f, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => new RegExp(l, "i"));
}

function trackedFiles() {
  try {
    return execFileSync("git", ["ls-files", "-z"], { cwd: REPO, encoding: "utf8" }).split("\0").filter(Boolean);
  } catch {
    // Not a git checkout (e.g. a copied skill folder): walk the tree instead.
    const out = [];
    const walk = (d) => {
      for (const e of fs.readdirSync(path.join(REPO, d), { withFileTypes: true })) {
        if (e.name === ".git" || e.name === "node_modules") continue;
        const rel = d ? `${d}/${e.name}` : e.name;
        if (e.isDirectory()) walk(rel);
        else out.push(rel);
      }
    };
    walk("");
    return out;
  }
}

test("no consuming-project name, path, ID or domain vocabulary appears in any tracked file", () => {
  const patterns = [...BUILTIN, ...localTerms()];
  const hits = [];
  for (const rel of trackedFiles()) {
    const abs = path.join(REPO, rel);
    if (!fs.existsSync(abs)) continue;
    const buf = fs.readFileSync(abs);
    if (buf.includes(0)) continue; // binary
    buf
      .toString("utf8")
      .split(/\r?\n/)
      .forEach((line, i) => {
        for (const re of patterns) if (re.test(line)) hits.push(`${rel}:${i + 1}  ${line.trim().slice(0, 110)}`);
      });
  }
  assert.deepEqual(hits, [], `consuming-project details found (see AGENTS.md):\n${hits.join("\n")}`);
});

test("the guard really detects a reference (so a green run means something)", () => {
  const sample = `see ${j("e", "mr-platform")} for details`;
  assert.ok(BUILTIN.some((re) => re.test(sample)));
  assert.ok(!BUILTIN.some((re) => re.test("a generic scaffold sentence about agents and gates")));
});
