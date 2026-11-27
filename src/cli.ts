#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { parseArgs } from "node:util";
import { canRunWithoutArgs, manifestProblems, parseEnv, signed, upsertEnv } from "./cli-helpers.ts";
import type { Manifest } from "./types.ts";

// The command line for utter-sdk.
//
//   npx utter-sdk init    sign in, save the project's keys, install, add the route, add the agent skill
//   npx utter-sdk check   check the running app's action list (and optionally run its reading actions)

const DEFAULT_URL = "https://app.utter.talk";
const SKILL_FILE = new URL("../skill/SKILL.md", import.meta.url);

const out = (s = "") => process.stdout.write(`${s}\n`);
const bold = (s: string) => (process.stdout.isTTY ? `\x1b[1m${s}\x1b[0m` : s);
const dim = (s: string) => (process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s);
const good = (s: string) => out(`  ${process.stdout.isTTY ? "\x1b[32m✓\x1b[0m" : "✓"} ${s}`);
const bad = (s: string) => out(`  ${process.stdout.isTTY ? "\x1b[31m✗\x1b[0m" : "✗"} ${s}`);
const note = (s: string) => out(`  ${dim("·")} ${s}`);

class Stop extends Error {}
const stop = (msg: string): never => {
  throw new Stop(msg);
};

/* ---- The project folder ---- */

type Project = {
  root: string;
  pkg: { name?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  ts: boolean;
  next: boolean;
  // "src" when the app keeps its code in src/, else "".
  base: string;
  appRouter: boolean;
  envFile: string;
};

function readProject(root: string): Project {
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) stop("There's no package.json here. Run this in your app's folder.");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const next = Boolean(deps.next);
  const base = existsSync(join(root, "src", "app")) || existsSync(join(root, "src", "pages")) ? "src" : "";
  const appRouter = existsSync(join(root, base, "app"));
  const envFile = existsSync(join(root, ".env.local")) || next ? ".env.local" : ".env";
  return { root, pkg, ts: existsSync(join(root, "tsconfig.json")), next, base, appRouter, envFile };
}

function readEnv(root: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const f of [".env", ".env.local"]) {
    const p = join(root, f);
    if (existsSync(p)) Object.assign(env, parseEnv(readFileSync(p, "utf8")));
  }
  return env;
}

function packageManager(root: string): { cmd: string; add: string[] } {
  if (existsSync(join(root, "pnpm-lock.yaml"))) return { cmd: "pnpm", add: ["add"] };
  if (existsSync(join(root, "yarn.lock"))) return { cmd: "yarn", add: ["add"] };
  if (existsSync(join(root, "bun.lockb")) || existsSync(join(root, "bun.lock"))) return { cmd: "bun", add: ["add"] };
  return { cmd: "npm", add: ["install"] };
}

function writeNew(root: string, file: string, text: string): boolean {
  const p = join(root, file);
  if (existsSync(p)) return false;
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
  return true;
}

/* ---- Signing in through the browser ---- */

function openBrowser(url: string) {
  const [cmd, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", '""', url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true, windowsVerbatimArguments: process.platform === "win32" });
    child.on("error", () => {});
    child.unref();
  } catch {
    // No browser to open (a server, a container): the link is printed anyway.
  }
}

async function api<T>(url: string, path: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; data: T }> {
  const res = await fetch(`${url}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!res) stop(`Can't reach Utter at ${url}. Check your internet connection.`);
  const data = (await res!.json().catch(() => ({}))) as T;
  return { status: res!.status, data };
}

type Keys = { id: string; name: string; hostUrl: string; secret: string };

async function signIn(url: string, open: boolean): Promise<Keys> {
  const { status, data } = await api<{ code?: string; userCode?: string; url?: string; error?: string }>(url, "/api/cli/start", {});
  if (status !== 200 || !data.code || !data.url) stop(data.error ?? `Utter couldn't start the sign-in (HTTP ${status}).`);
  out(`  Sign in and pick a project in your browser. Check it shows this code: ${bold(data.userCode!)}`);
  out(`  ${dim(data.url!)}`);
  if (open) openBrowser(data.url!);
  out();
  const until = Date.now() + 10 * 60_000;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 2000));
    const poll = await api<{ status?: string; project?: Keys; error?: string }>(url, "/api/cli/poll", { code: data.code });
    if (poll.data.status === "approved" && poll.data.project) return poll.data.project;
    if (poll.data.status === "expired") stop("The sign-in expired. Run the command again.");
    if (poll.status >= 400 && poll.status !== 429) stop(poll.data.error ?? `Utter said no (HTTP ${poll.status}).`);
  }
  return stop("The sign-in expired. Run the command again.");
}

/* ---- init ---- */

function libTemplate(p: Project): string {
  const name = (p.pkg.name ?? "My app").replace(/^@[^/]+\//, "").replace(/[-_]+/g, " ");
  const t = p.ts;
  return `import { createUtter } from "utter-sdk/server";

// Connects this app to Utter: people press the mic (or type), and Utter does it here, as them,
// with only the actions listed below. Your AI coding agent can fill this in: ask it to
// "Set up Utter in this app. Follow the utter skill."
// Docs: https://app.utter.talk/docs
export const utter = createUtter({
  manifest: {
    app: ${JSON.stringify(name)},
    // A sentence or two about the app.
    description: "",
    // Your data as TypeScript types, e.g. "type Lead = { id: string; name: string }".
    types: "",
    // What Utter may do. Mark actions that change data with writes: true; those always need a yes first.
    actions: [],
  },

  // One function per action, always for one customer company (tenantId) and one person (userId).
  actions: {},

  // Is this person part of this company? Utter only acts as real members.
  isMember: async (${t ? "_tenantId: string, _userId: string" : "_tenantId, _userId"}) => false,

  // Who is signed in, with your own login. Return null when nobody is.
  getViewer: async (${t ? "_req: Request" : "_req"}) => null,
});
`;
}

function routeTemplate(importPath: string): string {
  return `import { utter } from ${JSON.stringify(importPath)};

// Utter's signed calls (reading the action list, running actions) and your screens' calls.
export const { GET, POST } = utter.handler;
`;
}

const CURSOR_HEAD = `---
description: Connect this app to Utter (utter-sdk): the action list, sign-in and the voice button.
alwaysApply: false
---

`;

function installSkill(root: string): string[] {
  const text = readFileSync(SKILL_FILE, "utf8");
  const body = text.replace(/^---[\s\S]*?---\s*/, "");
  const files: [string, string][] = [
    [".claude/skills/utter/SKILL.md", text],
    [".agents/skills/utter/SKILL.md", text],
    [".cursor/rules/utter.mdc", CURSOR_HEAD + body],
  ];
  for (const [f, t] of files) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    writeFileSync(join(root, f), t);
  }
  return files.map(([f]) => f);
}

// Makes sure the env file with the secret isn't committed.
function keepOutOfGit(root: string, envFile: string): "ignored" | "added" | "no-git" {
  const check = spawnSync("git", ["check-ignore", "-q", envFile], { cwd: root });
  if (check.error || check.status === 128) return "no-git";
  if (check.status === 0) return "ignored";
  const gi = join(root, ".gitignore");
  const text = existsSync(gi) ? readFileSync(gi, "utf8") : "";
  appendFileSync(gi, `${text && !text.endsWith("\n") ? "\n" : ""}${envFile}\n`);
  return "added";
}

async function init(flags: { url?: string; "no-open"?: boolean; "no-install"?: boolean; "no-skill"?: boolean; relogin?: boolean }) {
  const root = process.cwd();
  const p = readProject(root);
  const env = readEnv(root);
  const url = (flags.url ?? env.UTTER_URL ?? process.env.UTTER_URL ?? DEFAULT_URL).replace(/\/+$/, "");

  out();
  out(bold("Utter setup"));
  out();

  // 1. Keys
  if (env.UTTER_PROJECT && env.UTTER_SECRET && !flags.relogin) {
    good(`Already has keys for project ${env.UTTER_PROJECT} ${dim("(--relogin to pick another)")}`);
  } else {
    const keys = await signIn(url, !flags["no-open"]);
    const envPath = join(root, p.envFile);
    const values: Record<string, string> = { UTTER_PROJECT: keys.id, UTTER_SECRET: keys.secret };
    if (url !== DEFAULT_URL) values.UTTER_URL = url;
    writeFileSync(envPath, upsertEnv(existsSync(envPath) ? readFileSync(envPath, "utf8") : "", values));
    good(`Connected to ${bold(keys.name)}: keys saved in ${p.envFile}`);
    const git = keepOutOfGit(root, p.envFile);
    if (git === "added") good(`Added ${p.envFile} to .gitignore, so the secret stays out of git`);
  }

  // 2. Package
  const has = Boolean(p.pkg.dependencies?.["utter-sdk"] || p.pkg.devDependencies?.["utter-sdk"]);
  if (has) good("utter-sdk is already installed");
  else if (flags["no-install"]) note("Skipped installing: run npm install utter-sdk");
  else {
    const pm = packageManager(root);
    out(`  ${dim(`${pm.cmd} ${pm.add.join(" ")} utter-sdk`)}`);
    const r = spawnSync(pm.cmd, [...pm.add, "utter-sdk"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
    if (r.status === 0) good("Installed utter-sdk");
    else bad(`Installing failed. Run ${pm.cmd} ${pm.add.join(" ")} utter-sdk yourself.`);
  }

  // 3. Files
  const ext = p.ts ? "ts" : "js";
  const lib = [p.base, "lib", `utter.${ext}`].filter(Boolean).join("/");
  if (writeNew(root, lib, libTemplate(p))) good(`Created ${lib}`);
  else good(`${lib} is already there`);
  if (p.next && p.appRouter) {
    const route = [p.base, "app", "api", "utter", "[...path]", `route.${ext}`].filter(Boolean).join("/");
    let rel = relative(dirname(join(root, route)), join(root, lib)).replace(/\\/g, "/").replace(/\.(ts|js)$/, "");
    if (!rel.startsWith(".")) rel = `./${rel}`;
    if (writeNew(root, route, routeTemplate(rel))) good(`Created ${route}`);
    else good(`${route} is already there`);
  } else {
    note(
      p.next
        ? "This app uses the pages/ folder. Add an app/api/utter/[...path]/route file that exports utter.handler (see the docs)."
        : "Not a Next.js app router project: serve utter.handler at /api/utter/* with your framework (see the docs).",
    );
  }

  // 4. Agent skill
  if (!flags["no-skill"]) {
    installSkill(root);
    good("Added the Utter skill for Claude Code, Codex and Cursor");
  }

  out();
  out(bold("Next: ask your AI coding agent to finish it"));
  out();
  out(`  ${bold("Set up Utter in this app. Follow the utter skill.")}`);
  out();
  out("  It reads your code and writes the actions Utter may run, hooks up your login, and puts the");
  out("  Utter button on your screens. Then run npx utter-sdk check, and switch it on in the dashboard:");
  out(`  ${dim(`${url}/dashboard`)}`);
  out();
}

/* ---- check ---- */

async function check(flags: { app?: string; tenant?: string; user?: string; url?: string }) {
  const root = process.cwd();
  const env = { ...readEnv(root), ...pick(process.env) };
  const url = (flags.url ?? env.UTTER_URL ?? DEFAULT_URL).replace(/\/+$/, "");
  const app = (flags.app ?? "http://localhost:3000").replace(/\/+$/, "");
  let problems = 0;
  const fail = (s: string) => {
    problems++;
    bad(s);
  };

  out();
  out(bold("Utter check"));
  out();

  const project = env.UTTER_PROJECT;
  const secret = env.UTTER_SECRET;
  if (!project || !secret) stop("UTTER_PROJECT and UTTER_SECRET aren't set in .env.local or .env. Run npx utter-sdk init first.");

  // Are the keys right?
  const v = await api<{ name?: string; hostUrl?: string; live?: boolean; error?: string }>(url, "/api/cli/verify", {}, {
    Authorization: `Bearer ${secret}`,
    "X-Utter-Project": project!,
  });
  if (v.status === 200) {
    good(`Keys work for ${bold(v.data.name ?? project!)}`);
    note(`Utter calls your app at ${v.data.hostUrl} (change it in the dashboard's Settings)`);
    note(v.data.live ? "Switched on: your customers see the Utter button" : "Not switched on yet: your customers don't see the Utter button");
  } else fail(v.data.error ?? `Utter didn't accept the keys (HTTP ${v.status}).`);

  // The action list, from the running app, the way Utter asks for it.
  let manifest: Manifest | null = null;
  const res = await fetch(`${app}/api/utter/manifest`, { headers: signed(secret!, "") }).catch(() => null);
  if (!res) fail(`Can't reach your app at ${app}. Is it running? Use --app to point somewhere else.`);
  else if (res.status === 401) fail("Your app turned down the signed request: its UTTER_SECRET doesn't match. Restart it after changing .env files.");
  else if (res.status === 404) fail(`${app}/api/utter/manifest wasn't found. Is the route file in place?`);
  else if (!res.ok) fail(`Your app answered HTTP ${res.status} for the action list. Check its logs.`);
  else {
    manifest = (await res.json().catch(() => null)) as Manifest | null;
    const p = manifestProblems(manifest);
    if (p.length === 0) {
      const writes = manifest!.actions.filter((a) => a.writes).length;
      good(`The action list is complete: ${manifest!.actions.length} actions, ${writes} of them change data`);
    }
    for (const x of p) fail(x);
  }

  // Each reading action, for one real company and person. Actions that change data are never run here.
  if (manifest && flags.tenant && flags.user) {
    for (const a of manifest.actions) {
      if (a.writes) continue;
      if (!canRunWithoutArgs(a.args)) {
        note(`${a.name} needs arguments, so it's skipped`);
        continue;
      }
      const body = JSON.stringify({ tenantId: flags.tenant, userId: flags.user, op: a.name, args: [] });
      const r = await fetch(`${app}/api/utter/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...signed(secret!, body) },
        body,
      }).catch(() => null);
      const data = (await r?.json().catch(() => null)) as { ok?: boolean; result?: unknown; error?: string } | null;
      if (!r || !data?.ok) fail(`${a.name} failed: ${data?.error ?? (r ? `HTTP ${r.status}` : "no answer")}`);
      else good(`${a.name} works${Array.isArray(data.result) ? ` (${data.result.length} rows)` : ""}`);
    }
  } else if (manifest) {
    note("Add --tenant <company id> --user <user id> to also run each reading action");
  }

  out();
  if (problems) {
    out(`${problems} ${problems === 1 ? "problem" : "problems"} to fix.`);
    process.exitCode = 1;
  } else out("All good.");
  out();
}

const pick = (e: NodeJS.ProcessEnv) =>
  Object.fromEntries(Object.entries(e).filter(([k, v]) => k.startsWith("UTTER_") && v)) as Record<string, string>;

/* ---- main ---- */

const HELP = `
Usage: npx utter-sdk <command>

  init     Connect this app: sign in, save the keys, install, add the route and the AI agent skill
           --relogin      pick a project again even if keys are saved
           --no-open      don't open the browser, just print the link
           --no-install   don't install the package
           --no-skill     don't add the agent skill files
  check    Check the running app's action list and keys
           --app <url>    where the app runs (default http://localhost:3000)
           --tenant <id> --user <id>   also run each reading action for this company and person

  --url <url>   a different Utter address (default ${DEFAULT_URL})
`;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      url: { type: "string" },
      app: { type: "string" },
      tenant: { type: "string" },
      user: { type: "string" },
      relogin: { type: "boolean" },
      "no-open": { type: "boolean" },
      "no-install": { type: "boolean" },
      "no-skill": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const cmd = positionals[0];
  if (values.help || !cmd) return out(HELP);
  if (cmd === "init") return init(values);
  if (cmd === "check") return check(values);
  out(`Unknown command: ${cmd}`);
  out(HELP);
  process.exitCode = 1;
}

main().catch((e) => {
  out();
  out(e instanceof Stop ? e.message : `Something went wrong: ${(e as Error).message}`);
  out();
  process.exitCode = 1;
});
