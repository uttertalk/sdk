// Tests for the part of utter-sdk that runs on your server: the signed route Utter calls,
// the browser routes your screens call, and the client that talks to Utter.
// They run against the built package in dist/ with a fake Utter, so they need no key and no network.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createUtter, UtterError } from "../dist/server.js";

const SECRET = "test-secret";
const URL_BASE = "https://utter.test";

const manifest = {
  app: "Test CRM",
  description: "A CRM for tests.",
  types: "type Lead = { id: string; name: string }",
  actions: [
    { name: "leads.list", description: "All leads", args: "()", returns: "Lead[]" },
    { name: "leads.rename", description: "Rename a lead", args: "(id, name)", returns: "Lead", writes: true },
    { name: "leads.fail", description: "Always fails", args: "()", returns: "never" },
  ],
};

// Which company each user belongs to.
const members = { u_ann: "t_north", u_bob: "t_blue" };

function setup(extra = {}) {
  const calls = [];
  const ss = createUtter({
    manifest,
    url: URL_BASE,
    project: "prj_test",
    secret: SECRET,
    actions: {
      "leads.list": (ctx) => {
        calls.push({ op: "leads.list", ctx });
        return [{ id: "l_1", name: "Acme", tenant: ctx.tenantId }];
      },
      "leads.rename": (ctx, id, name) => {
        calls.push({ op: "leads.rename", ctx, args: [id, name] });
        return { id, name };
      },
      "leads.fail": () => {
        throw new Error("Database is down.");
      },
    },
    isMember: (tenantId, userId) => members[userId] === tenantId,
    ...extra,
  });
  return { ss, calls };
}

// What Utter sends: HMAC-SHA256 of "<timestamp>.<body>" with the project secret.
function signed(body, { secret = SECRET, ts = Date.now(), sigOver } = {}) {
  const sig = createHmac("sha256", secret).update(`${ts}.${sigOver ?? body}`).digest("hex");
  return { "x-utter-timestamp": String(ts), "x-utter-signature": sig };
}

const ctxFor = (...path) => ({ params: Promise.resolve({ path }) });

async function callAction(ss, input, sign = {}) {
  const body = JSON.stringify(input);
  const req = new Request("https://app.test/api/utter/call", {
    method: "POST",
    headers: { "content-type": "application/json", ...signed(body, sign) },
    body,
  });
  const res = await ss.handler.POST(req, ctxFor("call"));
  return { status: res.status, body: await res.json() };
}

describe("manifest route", () => {
  test("answers a correctly signed request with the manifest", async () => {
    const { ss } = setup();
    const req = new Request("https://app.test/api/utter/manifest", { headers: signed("") });
    const res = await ss.handler.GET(req, ctxFor("manifest"));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), manifest);
  });

  test("turns away an unsigned request", async () => {
    const { ss } = setup();
    const res = await ss.handler.GET(new Request("https://app.test/api/utter/manifest"), ctxFor("manifest"));
    assert.equal(res.status, 401);
  });

  test("turns away a request signed with the wrong secret", async () => {
    const { ss } = setup();
    const req = new Request("https://app.test/api/utter/manifest", { headers: signed("", { secret: "someone-else" }) });
    assert.equal((await ss.handler.GET(req, ctxFor("manifest"))).status, 401);
  });

  test("turns everything away when no secret is set", async () => {
    const { ss } = setup({ secret: "" });
    const req = new Request("https://app.test/api/utter/manifest", { headers: signed("", { secret: "" }) });
    assert.equal((await ss.handler.GET(req, ctxFor("manifest"))).status, 401);
  });
});

describe("action route: signatures", () => {
  test("runs a correctly signed call", async () => {
    const { ss } = setup();
    const res = await callAction(ss, { tenantId: "t_north", userId: "u_ann", op: "leads.list", args: [] });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.result[0].tenant, "t_north");
  });

  test("turns away a call older than 5 minutes", async () => {
    const { ss, calls } = setup();
    const res = await callAction(ss, { tenantId: "t_north", userId: "u_ann", op: "leads.list" }, { ts: Date.now() - 6 * 60_000 });
    assert.equal(res.status, 401);
    assert.equal(calls.length, 0);
  });

  test("turns away a call stamped more than 5 minutes in the future", async () => {
    const { ss, calls } = setup();
    const res = await callAction(ss, { tenantId: "t_north", userId: "u_ann", op: "leads.list" }, { ts: Date.now() + 6 * 60_000 });
    assert.equal(res.status, 401);
    assert.equal(calls.length, 0);
  });

  test("turns away a call whose body was changed after signing", async () => {
    const { ss, calls } = setup();
    const original = JSON.stringify({ tenantId: "t_north", userId: "u_ann", op: "leads.list" });
    const res = await callAction(
      ss,
      { tenantId: "t_north", userId: "u_ann", op: "leads.rename", args: ["l_1", "Hacked"] },
      { sigOver: original },
    );
    assert.equal(res.status, 401);
    assert.equal(calls.length, 0);
  });

  test("turns away a call signed with the wrong secret", async () => {
    const { ss, calls } = setup();
    const res = await callAction(ss, { tenantId: "t_north", userId: "u_ann", op: "leads.list" }, { secret: "guess" });
    assert.equal(res.status, 401);
    assert.equal(calls.length, 0);
  });
});

describe("action route: who and what", () => {
  test("refuses a user who isn't part of that company", async () => {
    const { ss, calls } = setup();
    const res = await callAction(ss, { tenantId: "t_north", userId: "u_bob", op: "leads.list" });
    assert.equal(res.status, 403);
    assert.equal(calls.length, 0);
  });

  test("passes the company and user to the action, with its arguments", async () => {
    const { ss, calls } = setup();
    const res = await callAction(ss, { tenantId: "t_blue", userId: "u_bob", op: "leads.rename", args: ["l_9", "Bluepeak"] });
    assert.equal(res.status, 200);
    assert.deepEqual(calls[0], { op: "leads.rename", ctx: { tenantId: "t_blue", userId: "u_bob" }, args: ["l_9", "Bluepeak"] });
  });

  test("refuses an action that isn't listed", async () => {
    const { ss } = setup();
    const res = await callAction(ss, { tenantId: "t_north", userId: "u_ann", op: "leads.delete" });
    assert.equal(res.status, 400);
  });

  for (const op of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    test(`never treats "${op}" as an action`, async () => {
      const { ss } = setup();
      const res = await callAction(ss, { tenantId: "t_north", userId: "u_ann", op });
      assert.equal(res.status, 400);
    });
  }

  test("refuses an action that's implemented but not on the action list", async () => {
    const { ss, calls } = setup({
      actions: { "leads.list": () => [], "leads.wipe": () => calls.push("wiped") },
    });
    const res = await callAction(ss, { tenantId: "t_north", userId: "u_ann", op: "leads.wipe" });
    assert.equal(res.status, 400);
    assert.equal(calls.length, 0);
  });

  test("refuses a call without a company or person", async () => {
    const { ss, calls } = setup({ isMember: () => true });
    const res = await callAction(ss, { op: "leads.list" });
    assert.equal(res.status, 403);
    assert.equal(calls.length, 0);
  });

  test("reports an action's error without crashing", async () => {
    const { ss } = setup();
    const res = await callAction(ss, { tenantId: "t_north", userId: "u_ann", op: "leads.fail" });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "Database is down.");
  });

  test("turns away a signed body that isn't JSON", async () => {
    const { ss } = setup();
    const body = "not json";
    const req = new Request("https://app.test/api/utter/call", { method: "POST", headers: signed(body), body });
    assert.equal((await ss.handler.POST(req, ctxFor("call"))).status, 400);
  });
});

// A fake Utter: hands out sessions for the right project secret and answers /render.
describe("browser routes and client", () => {
  let realFetch;
  let sent;
  let sessionsIssued;
  let rejectNextToken;

  beforeEach(() => {
    realFetch = globalThis.fetch;
    sent = [];
    sessionsIssued = 0;
    rejectNextToken = false;
    globalThis.fetch = async (url, init = {}) => {
      const headers = new Headers(init.headers);
      sent.push({ url: String(url), method: init.method, auth: headers.get("authorization"), project: headers.get("x-utter-project"), body: init.body });
      const path = String(url).replace(URL_BASE, "");
      if (path === "/api/v1/sessions") {
        if (headers.get("authorization") !== `Bearer ${SECRET}` || headers.get("x-utter-project") !== "prj_test") {
          return Response.json({ error: "Wrong project or secret." }, { status: 401 });
        }
        sessionsIssued++;
        return Response.json({ token: `tok_${sessionsIssued}`, expiresAt: Date.now() + 3_600_000 });
      }
      if (rejectNextToken) {
        rejectNextToken = false;
        return Response.json({ error: "Session expired." }, { status: 401 });
      }
      if (path === "/api/v1/ask") return Response.json({ kind: "answer", text: "You have 3 leads.", list: [] });
      if (path === "/api/v1/confirm") return Response.json({ kind: "answer", text: "Done.", list: [], done: 1, failed: 0 });
      if (path === "/api/v1/status") return Response.json({ live: true, app: "Test CRM" });
      if (path === "/api/v1/look") return Response.json({ css: "html{filter:invert(1)}" });
      if (path === "/api/v1/undo-look") return Response.json({ css: "" });
      return Response.json({ error: "Not found." }, { status: 404 });
    };
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const viewer = { tenant: { id: "t_north", name: "Northwind" }, user: { id: "u_ann", name: "Ann" } };

  test("browser routes refuse when nobody is signed in", async () => {
    const { ss } = setup({ getViewer: () => null });
    const req = new Request("https://app.test/api/utter/ask", { method: "POST", body: "{}" });
    assert.equal((await ss.handler.POST(req, ctxFor("ask"))).status, 401);
    assert.equal(sent.length, 0);
  });

  test("browser routes refuse when getViewer isn't set up", async () => {
    const { ss } = setup();
    const req = new Request("https://app.test/api/utter/ask", { method: "POST", body: "{}" });
    assert.equal((await ss.handler.POST(req, ctxFor("ask"))).status, 401);
  });

  test("asks Utter for a session with the project secret, then uses only the session token", async () => {
    const { ss } = setup();
    await ss.client(viewer).ask([{ role: "user", text: "How many leads?" }]);
    assert.equal(sent[0].url, `${URL_BASE}/api/v1/sessions`);
    assert.equal(sent[0].auth, `Bearer ${SECRET}`);
    assert.equal(sent[0].project, "prj_test");
    assert.deepEqual(JSON.parse(sent[0].body), viewer);
    assert.equal(sent[1].url, `${URL_BASE}/api/v1/ask`);
    assert.equal(sent[1].auth, "Bearer tok_1");
    assert.ok(!String(sent[1].body).includes(SECRET), "the secret never goes into a normal call");
  });

  test("reuses a session instead of asking for a new one each time", async () => {
    const { ss } = setup();
    await ss.client(viewer).status();
    await ss.client(viewer).status();
    assert.equal(sessionsIssued, 1);
  });

  test("gets a new session once when Utter no longer accepts the old one", async () => {
    const { ss } = setup();
    await ss.client(viewer).status();
    rejectNextToken = true;
    await ss.client(viewer).status();
    assert.equal(sessionsIssued, 2);
  });

  test("throws a UtterError when the project secret is wrong", async () => {
    const { ss } = setup({ secret: "wrong" });
    await assert.rejects(ss.client(viewer).status(), (e) => e instanceof UtterError && /Wrong project or secret/.test(e.message));
  });

  test("a signed-in browser request is passed on as that viewer", async () => {
    const { ss } = setup({ getViewer: () => viewer });
    const conversation = [{ role: "user", text: "How many leads?" }];
    const req = new Request("https://app.test/api/utter/ask", { method: "POST", body: JSON.stringify({ conversation }) });
    const res = await ss.handler.POST(req, ctxFor("ask"));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).text, "You have 3 leads.");
    assert.deepEqual(JSON.parse(sent[0].body), viewer);
    assert.deepEqual(JSON.parse(sent[1].body), { conversation });
  });

  test("confirm passes the plan and its signature through unchanged", async () => {
    const { ss } = setup({ getViewer: () => viewer });
    const req = new Request("https://app.test/api/utter/confirm", { method: "POST", body: JSON.stringify({ plan: "p1", sig: "s1" }) });
    const res = await ss.handler.POST(req, ctxFor("confirm"));
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(sent[1].body), { plan: "p1", sig: "s1" });
  });

  test("the page outline is passed on with the request, and left out when not sent", async () => {
    const { ss } = setup({ getViewer: () => viewer });
    const conversation = [{ role: "user", text: "Make it dark" }];
    const withPage = new Request("https://app.test/api/utter/ask", { method: "POST", body: JSON.stringify({ conversation, page: "body main" }) });
    await ss.handler.POST(withPage, ctxFor("ask"));
    assert.deepEqual(JSON.parse(sent[1].body), { conversation, page: "body main" });
    const without = new Request("https://app.test/api/utter/ask", { method: "POST", body: JSON.stringify({ conversation, page: 42 }) });
    await ss.handler.POST(without, ctxFor("ask"));
    assert.deepEqual(JSON.parse(sent[2].body), { conversation });
  });

  test("a person's look and undo are passed on for the signed-in viewer", async () => {
    const { ss } = setup({ getViewer: () => viewer });
    const look = await ss.handler.GET(new Request("https://app.test/api/utter/look"), ctxFor("look"));
    assert.deepEqual(await look.json(), { css: "html{filter:invert(1)}" });
    assert.equal(sent[1].url, `${URL_BASE}/api/v1/look`);
    const undo = await ss.handler.POST(new Request("https://app.test/api/utter/undo-look", { method: "POST", body: "{}" }), ctxFor("undo-look"));
    assert.deepEqual(await undo.json(), { css: "" });
    assert.equal(sent[2].url, `${URL_BASE}/api/v1/undo-look`);
    assert.equal(sent[2].method, "POST");
  });

  test("looks need someone signed in", async () => {
    const { ss } = setup({ getViewer: () => null });
    assert.equal((await ss.handler.GET(new Request("https://app.test/api/utter/look"), ctxFor("look"))).status, 401);
    assert.equal(sent.length, 0);
  });

  test("unknown browser paths are not found", async () => {
    const { ss } = setup({ getViewer: () => viewer });
    const req = new Request("https://app.test/api/utter/addons", { method: "POST", body: "{}" });
    assert.equal((await ss.handler.POST(req, ctxFor("addons"))).status, 404);
  });
});
