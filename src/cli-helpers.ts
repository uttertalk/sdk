import { createHmac } from "node:crypto";
import type { Manifest } from "./types.ts";

// Plain helpers for the command line (cli.ts), kept apart so the tests can use them.

// Reads KEY=value lines (quotes optional, # comments ignored).
export function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    env[m[1]] = v;
  }
  return env;
}

// Sets keys in an env file's text: replaces lines that are there, adds the rest at the end. Keeps everything else.
export function upsertEnv(text: string, values: Record<string, string>): string {
  const lines = text ? text.split(/\r?\n/) : [];
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  const left = new Map(Object.entries(values));
  const next = lines.map((line) => {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m && left.has(m[1])) {
      const v = left.get(m[1])!;
      left.delete(m[1]);
      return `${m[1]}=${v}`;
    }
    return line;
  });
  if (left.size) {
    if (next.length && next[next.length - 1].trim() !== "") next.push("");
    next.push("# Utter (keep the secret out of git)");
    for (const [k, v] of left) next.push(`${k}=${v}`);
  }
  return `${next.join("\n")}\n`;
}

// What's wrong with an action list, in plain words. Empty when it's fine.
export function manifestProblems(m: Partial<Manifest> | null | undefined): string[] {
  if (!m || typeof m !== "object") return ["The action list is missing."];
  const p: string[] = [];
  if (!m.app?.trim()) p.push("manifest.app is empty: give your product's name.");
  if (!m.description?.trim()) p.push("manifest.description is empty: describe the app in a sentence or two.");
  if (!m.types?.trim()) p.push("manifest.types is empty: add the TypeScript types your actions take and return.");
  const actions = Array.isArray(m.actions) ? m.actions : [];
  if (actions.length === 0) p.push("manifest.actions is empty: list at least one action Utter may run.");
  const names = new Set<string>();
  for (const a of actions) {
    if (!a?.name) {
      p.push("An action has no name.");
      continue;
    }
    if (names.has(a.name)) p.push(`The action ${a.name} is listed twice.`);
    names.add(a.name);
    if (!a.description?.trim()) p.push(`The action ${a.name} has no description.`);
    if (typeof a.args !== "string") p.push(`The action ${a.name} needs args, like "()" or "(id: string)".`);
    if (typeof a.returns !== "string" || !a.returns.trim()) p.push(`The action ${a.name} needs returns, like "Lead[]".`);
  }
  return p;
}

// Can an action with this argument list be called with no arguments? True for "()" and when every
// argument is optional, like "(opts?: { status?: string })".
export function canRunWithoutArgs(args: string): boolean {
  const inner = args.trim().replace(/^\(/, "").replace(/\)$/, "").trim();
  if (!inner) return true;
  const params: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of inner) {
    if ("{[(<".includes(ch)) depth++;
    if ("}])>".includes(ch)) depth--;
    if (ch === "," && depth === 0) {
      params.push(current);
      current = "";
    } else current += ch;
  }
  params.push(current);
  return params.every((p) => /^\s*(\.\.\.)?[A-Za-z_$][\w$]*\s*\?/.test(p) || /^\s*\.\.\./.test(p));
}

export function signed(secret: string, body: string): Record<string, string> {
  const ts = String(Date.now());
  const sig = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  return { "X-Utter-Timestamp": ts, "X-Utter-Signature": sig };
}
