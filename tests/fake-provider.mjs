// Deterministic stand-in for a provider CLI, so the orchestrator's gates can be tested with no
// network, no tokens and no randomness. Reads the prompt from stdin like the real CLIs do.
//
// Dispatch mode (default): scans the prompt for directives of the form `DO:<verb>:<arg>` and
// performs them in the current directory (the worktree, when there is one):
//   DO:WRITE:path=content     write a file        DO:APPEND:path=content   append to a file
//   DO:DELETE:path            delete a file       DO:SLEEP:ms              block for ms milliseconds
//   DO:FAIL                   exit non-zero
// Advice mode (`--advice` in argv, i.e. the provider's adviceArgs): answers instead of acting.
//   a prompt containing `DO:VERDICT:FAIL` makes the reviewer end with `VERDICT: FAIL - ...`,
//   otherwise `VERDICT: PASS`. Anything else gets the fixed answer `fake-answer`.
// If FAKE_ARGV_LOG is set, the full argv is written there (outside the repo) so a test can assert
// which flags the orchestrator passed.
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
if (process.env.FAKE_ARGV_LOG) fs.appendFileSync(process.env.FAKE_ARGV_LOG, JSON.stringify(argv) + "\n");

const prompt = fs.readFileSync(0, "utf8");

if (argv.includes("--advice")) {
  if (/DO:VERDICT:FAIL/.test(prompt)) console.log("Findings: the change does not do what was asked.\nVERDICT: FAIL - fake reviewer rejects this change");
  else if (/DO:VERDICT:BOLD/.test(prompt)) console.log("Findings: fine.\n\n**VERDICT: PASS**");
  else if (/DO:VERDICT:NONE/.test(prompt)) console.log("Findings: looks fine, no verdict line given.");
  else if (/\(empty diff\)/.test(prompt)) console.log("Findings: the diff is empty.\nVERDICT: FAIL - no files appear in the diff");
  else if (/Independent reviewer|independent reviewer/.test(prompt)) console.log("Findings: matches the task.\nVERDICT: PASS");
  else console.log("fake-answer");
  process.exit(0);
}

for (const m of prompt.matchAll(/DO:([A-Z]+)(?::([^\r\n]*))?/g)) {
  const [, verb, arg = ""] = m;
  if (verb === "WRITE" || verb === "APPEND") {
    const eq = arg.indexOf("=");
    const file = arg.slice(0, eq);
    const content = arg.slice(eq + 1);
    fs.mkdirSync(path.dirname(file) || ".", { recursive: true });
    (verb === "WRITE" ? fs.writeFileSync : fs.appendFileSync)(file, content);
  } else if (verb === "DELETE") {
    fs.rmSync(arg, { force: true });
  } else if (verb === "SLEEP") {
    await new Promise((r) => setTimeout(r, Number(arg)));
  } else if (verb === "FAIL") {
    process.exit(1);
  }
}
console.log("CHECKS\n1. PASS - fake - evidence: fake\nUNVERIFIED\n- none");
