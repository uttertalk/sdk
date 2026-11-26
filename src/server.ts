import { createHmac, timingSafeEqual } from "node:crypto";
import type { ActivityEntry, AskResult, ConfirmResult, Manifest, Turn, Viewer } from "./types.ts";

export * from "./types.ts";

// Connecting a product to Utter, on the product's server.
//
//   const utter = createUtter({
//     manifest,                                // the action list: what Utter may do
//     actions: { "leads.list": ({ tenantId }) => ..., ... },
//     isMember: (tenantId, userId) => ...,     // does this person belong to this company?
//     getViewer: (req) => ...,                 // who is signed in (for the browser routes)
//   });
//
//   // app/api/utter/[...path]/route.ts
//   export const { GET, POST } = utter.handler;
//
// Settings come from UTTER_URL, UTTER_PROJECT and UTTER_SECRET unless passed in.

export type ActionContext = { tenantId: string; userId: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Action = (ctx: ActionContext, ...args: any[]) => Promise<unknown> | unknown;

export type UtterOptions = {
  manifest: Manifest;
  actions: Record<string, Action>;
  isMember: (tenantId: string, userId: string) => Promise<boolean> | boolean;
  getViewer?: (req: Request) => Promise<Viewer | null> | Viewer | null;
  url?: string;
  project?: string;
  secret?: string;
};

export class UtterError extends Error {}

const MAX_AGE_MS = 5 * 60_000;
// Utter's address, unless UTTER_URL or the url option says otherwise.
const DEFAULT_URL = "https://app.utter.talk";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

export function createUtter(opts: UtterOptions) {
  const url = (opts.url ?? process.env.UTTER_URL ?? DEFAULT_URL).replace(/\/+$/, "");
  const project = opts.project ?? process.env.UTTER_PROJECT ?? "";
  const secret = opts.secret ?? process.env.UTTER_SECRET ?? "";

  /* ---- Calling Utter for one signed-in person ---- */

  // One session per person, reused until 5 minutes before Utter says it expires.
  const sessions = new Map<string, { token: string; until: number }>();
  const sessionKey = (viewer: Viewer) => `${viewer.tenant.id}:${viewer.user.id}`;

  async function session(viewer: Viewer): Promise<string> {
    const key = sessionKey(viewer);
    const hit = sessions.get(key);
    if (hit && hit.until > Date.now()) return hit.token;
    const res = await fetch(`${url}/api/v1/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}`, "X-Utter-Project": project },
      body: JSON.stringify(viewer),
      cache: "no-store",
    }).catch(() => null);
    if (!res) throw new UtterError("Utter is not reachable.");
    const data = (await res.json().catch(() => ({}))) as { token?: string; expiresAt?: number; error?: string };
    if (!res.ok || !data.token) throw new UtterError(data.error ?? `Utter is not reachable (HTTP ${res.status}).`);
    const until = (typeof data.expiresAt === "number" ? data.expiresAt : Date.now() + 3_600_000) - 5 * 60_000;
    sessions.set(key, { token: data.token, until });
    return data.token;
  }

  async function call<T>(viewer: Viewer, path: string, body?: unknown, retried = false): Promise<T> {
    const token = await session(viewer);
    const res = await fetch(`${url}/api/v1${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    }).catch(() => null);
    if (!res) throw new UtterError("Utter is not reachable.");
    // A session Utter no longer accepts: forget it and try once more with a new one.
    if (res.status === 401 && !retried) {
      sessions.delete(sessionKey(viewer));
      return call<T>(viewer, path, body, true);
    }
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new UtterError(data.error ?? `Utter error (HTTP ${res.status}).`);
    return data;
  }

  function client(viewer: Viewer) {
    return {
      status: () => call<{ live: boolean; app: string; looks?: boolean }>(viewer, "/status"),
      // `page`: an outline of what's on the person's screen, so they can change their own look.
      ask: (conversation: Turn[], page?: string) => call<AskResult>(viewer, "/ask", page === undefined ? { conversation } : { conversation, page }),
      look: () => call<{ css: string }>(viewer, "/look"),
      undoLook: () => call<{ css: string }>(viewer, "/undo-look", {}),
      confirm: (plan: string, sig: string) => call<ConfirmResult>(viewer, "/confirm", { plan, sig }),
      cancel: (plan: string, sig: string) => call<ConfirmResult>(viewer, "/cancel", { plan, sig }),
      activity: (o: { before?: string; limit?: number } = {}) => {
        const q = new URLSearchParams();
        if (o.before) q.set("before", o.before);
        if (o.limit) q.set("limit", String(o.limit));
        return call<{ entries: ActivityEntry[]; next: string | null }>(viewer, `/activity${q.size ? `?${q}` : ""}`);
      },
    };
  }

  /* ---- Answering Utter, and the browser ---- */

  function verified(req: Request, body: string): boolean {
    const ts = req.headers.get("x-utter-timestamp") ?? "";
    const sig = req.headers.get("x-utter-signature") ?? "";
    if (!secret || !ts || !sig || Math.abs(Date.now() - Number(ts)) > MAX_AGE_MS) return false;
    const expected = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  // Utter runs one of the product's actions for one company and one of its people.
  async function handleCall(req: Request): Promise<Response> {
    const raw = await req.text();
    if (!verified(req, raw)) return json({ ok: false, error: "Bad signature." }, 401);
    let input: { tenantId?: string; userId?: string; op?: string; args?: unknown[] };
    try {
      input = JSON.parse(raw);
    } catch {
      return json({ ok: false, error: "Bad request." }, 400);
    }
    const { tenantId = "", userId = "", op = "", args = [] } = input;
    if (!tenantId || !userId || !(await opts.isMember(tenantId, userId))) {
      return json({ ok: false, error: "That person isn't part of that company." }, 403);
    }
    // Only actions that are both on the action list and implemented, never names every object has (like "constructor").
    const listed = opts.manifest.actions.some((a) => a.name === op);
    const action = listed && Object.hasOwn(opts.actions, op) ? opts.actions[op] : undefined;
    if (!action) return json({ ok: false, error: `Unknown action: ${op}` }, 400);
    try {
      const result = await action({ tenantId, userId }, ...(Array.isArray(args) ? args : []));
      return json({ ok: true, result: JSON.parse(JSON.stringify(result ?? null)) });
    } catch (e) {
      return json({ ok: false, error: (e as Error).message }, 400);
    }
  }

  // Browser routes: the product's own screens, signed in with the product's own login.
  async function handleBrowser(req: Request, path: string[], method: string): Promise<Response> {
    const viewer = opts.getViewer ? await opts.getViewer(req) : null;
    if (!viewer) return json({ error: "Not signed in." }, 401);
    if (path.length !== 1) return json({ error: "Not found." }, 404);
    const c = client(viewer);
    const b = method === "GET" ? {} : ((await req.json().catch(() => ({}))) as Record<string, unknown>);
    const [first] = path;
    try {
      if (method === "GET" && first === "status") return json(await c.status());
      if (method === "POST" && first === "ask") {
        return json(await c.ask((b.conversation as Turn[]) ?? [], typeof b.page === "string" ? b.page : undefined));
      }
      if (method === "GET" && first === "look") return json(await c.look());
      if (method === "POST" && first === "undo-look") return json(await c.undoLook());
      if (method === "POST" && first === "confirm") return json(await c.confirm(String(b.plan ?? ""), String(b.sig ?? "")));
      if (method === "POST" && first === "cancel") return json(await c.cancel(String(b.plan ?? ""), String(b.sig ?? "")));
      if (method === "GET" && first === "activity") {
        const q = new URL(req.url).searchParams;
        return json(await c.activity({ before: q.get("before") ?? undefined, limit: Number(q.get("limit")) || undefined }));
      }
      return json({ error: "Not found." }, 404);
    } catch (e) {
      return json({ error: (e as Error).message }, e instanceof UtterError ? 502 : 500);
    }
  }

  type Ctx = { params: Promise<{ path?: string[] }> };
  const route = (method: string) => async (req: Request, ctx: Ctx) => {
    const path = (await ctx.params).path ?? [];
    if (method === "GET" && path[0] === "manifest" && path.length === 1) {
      return verified(req, "") ? json(opts.manifest) : json({ error: "Bad signature." }, 401);
    }
    if (method === "POST" && path[0] === "call" && path.length === 1) return handleCall(req);
    return handleBrowser(req, path, method);
  };

  return { client, handler: { GET: route("GET"), POST: route("POST") } };
}
