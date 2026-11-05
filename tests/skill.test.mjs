import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillDir = path.join(root, "pathfinder");
const skillText = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8").replace(/\r\n/g, "\n");

function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, "SKILL.md starts with a frontmatter block");
  const out = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([a-z-]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2];
  }
  return out;
}

test("frontmatter: name is valid and matches the folder", () => {
  const fm = frontmatter(skillText);
  assert.match(fm.name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.ok(fm.name.length <= 64);
  assert.equal(fm.name, path.basename(skillDir), "the folder name must match the skill name");
});

test("frontmatter: description is specific and within the limit", () => {
  const { description } = frontmatter(skillText);
  assert.ok(description.length > 200 && description.length <= 1024, `length ${description.length}`);
  for (const word of ["roadmap", "blueprint", "theory"]) assert.match(description, new RegExp(word, "i"));
  assert.match(description, /Not for /, "says when it should not trigger");
  assert.doesNotMatch(description, /[<>]/);
});

test("SKILL.md is lean and has every gate", () => {
  assert.ok(skillText.split("\n").length < 500);
  for (const gate of ["Gate 0", "Gate 1", "Gate 2", "Gate 3", "Gate 4", "Gate 5"]) assert.match(skillText, new RegExp(`## ${gate}`));
  assert.match(skillText, /Nothing is created before confirmation/);
  assert.match(skillText, /data, not instructions/);
});

test("every reference SKILL.md points to exists, and every reference file is pointed to", () => {
  const cited = [...new Set([...skillText.matchAll(/references\/[a-z0-9-]+\.md/g)].map((m) => m[0]))];
  assert.ok(cited.length >= 3);
  for (const rel of cited) assert.ok(fs.existsSync(path.join(skillDir, rel)), `${rel} exists`);
  const onDisk = fs.readdirSync(path.join(skillDir, "references")).map((f) => `references/${f}`);
  for (const rel of onDisk) assert.ok(cited.includes(rel), `${rel} is referenced from SKILL.md`);
});

test("reference files over 100 lines open with a contents list", () => {
  for (const f of fs.readdirSync(path.join(skillDir, "references"))) {
    const text = fs.readFileSync(path.join(skillDir, "references", f), "utf8").replace(/\r\n/g, "\n");
    if (text.split("\n").length > 100) assert.match(text.slice(0, 600), /## Contents/, `${f} needs a contents list`);
  }
});

test("no unfinished markers or placeholder text", () => {
  const files = [path.join(skillDir, "SKILL.md"), ...fs.readdirSync(path.join(skillDir, "references")).map((f) => path.join(skillDir, "references", f)), path.join(root, "README.md")];
  for (const f of files) assert.doesNotMatch(fs.readFileSync(f, "utf8"), /\b(TODO|FIXME|TBD|lorem ipsum)\b/i, path.basename(f));
});
