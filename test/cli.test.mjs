import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { canRunWithoutArgs, manifestProblems, parseEnv, signed, upsertEnv } from "../dist/cli-helpers.js";

test("parseEnv reads plain, quoted and commented lines", () => {
  const env = parseEnv('A=1\n# note\nB="two words"\nexport C=3 # trailing\nD=\'x#y\'\nnot a line\n');
  assert.deepEqual(env, { A: "1", B: "two words", C: "3", D: "x#y" });
});

test("upsertEnv replaces keys that are there and adds the rest, keeping other lines", () => {
  const before = "DATABASE_URL=postgres://x\nUTTER_PROJECT=old\n";
  const after = upsertEnv(before, { UTTER_PROJECT: "prj_1", UTTER_SECRET: "sk_1" });
  assert.equal(after, "DATABASE_URL=postgres://x\nUTTER_PROJECT=prj_1\n\n# Utter (keep the secret out of git)\nUTTER_SECRET=sk_1\n");
  assert.equal(upsertEnv("", { A: "1" }), "# Utter (keep the secret out of git)\nA=1\n");
});

test("manifestProblems is empty for a complete manifest", () => {
  const m = {
    app: "Acme",
    description: "A CRM.",
    types: "type Lead = { id: string }",
    actions: [{ name: "leads.list", description: "All leads", args: "()", returns: "Lead[]" }],
  };
  assert.deepEqual(manifestProblems(m), []);
});

test("manifestProblems explains what's missing", () => {
  const p = manifestProblems({
    app: "Acme",
    description: "",
    types: "",
    actions: [
      { name: "leads.list", description: "", args: "()", returns: "Lead[]" },
      { name: "leads.list", description: "Again", args: "()", returns: "Lead[]" },
    ],
  });
  assert.ok(p.some((x) => x.includes("description is empty")));
  assert.ok(p.some((x) => x.includes("types is empty")));
  assert.ok(p.some((x) => x.includes("leads.list has no description")));
  assert.ok(p.some((x) => x.includes("leads.list is listed twice")));
  assert.deepEqual(manifestProblems(null), ["The action list is missing."]);
  assert.ok(manifestProblems({ app: "A", description: "B", types: "C", actions: [] }).some((x) => x.includes("actions is empty")));
});

test("signed makes the same signature the SDK server checks", () => {
  const h = signed("sk_test", '{"a":1}');
  const expected = createHmac("sha256", "sk_test").update(`${h["X-Utter-Timestamp"]}.{"a":1}`).digest("hex");
  assert.equal(h["X-Utter-Signature"], expected);
});

test("canRunWithoutArgs is true only when every argument is optional", () => {
  assert.equal(canRunWithoutArgs("()"), true);
  assert.equal(canRunWithoutArgs(""), true);
  assert.equal(canRunWithoutArgs("(opts?: { status?: string; q?: string })"), true);
  assert.equal(canRunWithoutArgs("(leadId?: string, limit?: number)"), true);
  assert.equal(canRunWithoutArgs("(id: string)"), false);
  assert.equal(canRunWithoutArgs("(id: string, patch?: { a?: string })"), false);
});
