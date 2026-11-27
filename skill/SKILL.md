---
name: utter
description: Connect this app to Utter (utter-sdk), so its users can change it by asking, out loud or typed: their own look, and work Utter does inside the app as them. Use when asked to set up, finish, fix or extend Utter, the Utter button, the Utter action list, or lib/utter.ts.
---

# Set up Utter in this app

Utter is a voice and typing button for this app. A signed-in person presses the mic (or types) and says what they want: "move my stale leads to Cold", "which deals close this month?". Utter answers out loud, or does it inside the app, as that person, using only the actions this app lists. Anything that changes data is shown to the person as a plan first and only runs after they say yes. Utter never sees the database or the code.

`npx utter-sdk init` already did the mechanical part: the keys are in the env file, the package is installed, and there's an `utter` file (usually `lib/utter.ts`) plus a catch-all route (`app/api/utter/[...path]/route.ts`). Your job is to fill in the `utter` file and put the button on screen. Work through the steps in order and show the developer what you changed.

## 1. Learn the app

Before writing anything, find:

- **The data**: the ORM or database layer (Prisma, Drizzle, TypeORM, Mongoose, Supabase, SQL, an internal API) and the main records people work with (leads, orders, tickets, projects…).
- **Tenancy**: how a customer company is represented (`organizationId`, `workspaceId`, `teamId`, `accountId`…) and how a user belongs to one. Every action must be limited to one company.
- **Login**: how the server knows who is signed in (Auth.js/NextAuth `auth()`, Clerk `auth()`/`currentUser()`, Supabase `getUser()`, Lucia, iron-session, a custom cookie…).
- **The screens**: the signed-in layout (where the button goes) and how pages load their data (so they can refresh after Utter changes something).
- **What people do all day**: the tasks they repeat in this app. Those are the actions worth listing.

If something important is unclear (for example two possible tenant fields), ask the developer instead of guessing.

## 2. Write the action list

The action list (`manifest`) is everything Utter's AI knows about the app. Keep it small and true.

```ts
manifest: {
  app: "Acme CRM",                                   // the product's name
  description: "A CRM for small sales teams.",        // one or two plain sentences
  types: `type Lead = { id: string; name: string; company: string; value: number; status: "new" | "qualified" | "won" | "lost"; ownerId: string | null; lastContactAt: string | null }
type User = { id: string; name: string }`,
  actions: [
    { name: "leads.list", description: "The company's leads, newest first, optionally filtered by status or a search", args: "(opts?: { status?: Lead[\"status\"]; q?: string })", returns: "Lead[]" },
    { name: "leads.get", description: "One lead", args: "(id: string)", returns: "Lead | null" },
    { name: "users.list", description: "The company's team (possible owners)", args: "()", returns: "User[]" },
    { name: "leads.update", description: "Change a lead's status, value or owner", args: "(id: string, patch: { status?: Lead[\"status\"]; value?: number; ownerId?: string | null })", returns: "Lead", writes: true },
  ],
}
```

Rules:

- **Reading actions first.** Cover the main records with list and get actions, with simple filters (status, search, date range) so Utter doesn't have to read everything. These run right away and change nothing.
- **A few safe writes.** Add only actions that are safe and useful to do by voice: change a status, assign an owner, add a note, log a call, set a due date. Mark every action that changes data with `writes: true`. Utter shows those to the person as a plan and only runs them after a yes.
- **Leave out by default**: deleting anything, billing and payments, users, roles and permissions, sending email or messages to people outside the company, exports, and anything the developer wouldn't want done by voice. When unsure, leave it out and mention it.
- **types** are TypeScript types of what actions take and return, as plain JSON (dates as ISO strings). Only fields that are useful and safe to show. Leave out password hashes, tokens, internal notes, card numbers and anything secret.
- Names are `thing.verb` (`leads.list`, `notes.create`). `args` is the argument list in parentheses, `"()"` for none. Descriptions are one plain sentence; say what filters do and what order results come in.
- Lists should return a sensible amount (cap at a few hundred). Utter reads results, so smaller is faster and cheaper.

## 3. Write the actions

One function per action in `actions`, using the app's own data layer. Each gets `{ tenantId, userId }` first, then the action's arguments.

```ts
actions: {
  "leads.list": ({ tenantId }, opts) => {
    const o = (opts ?? {}) as { status?: string; q?: string };
    return db.lead.findMany({
      where: { orgId: tenantId, status: o.status, name: o.q ? { contains: String(o.q) } : undefined },
      orderBy: { createdAt: "desc" },
      take: 300,
    });
  },
  "leads.update": async ({ tenantId }, id, patch) => {
    const p = (patch ?? {}) as { status?: string; value?: number; ownerId?: string | null };
    // Only the fields the action list promises, and only inside this company.
    return db.lead.update({ where: { id: String(id), orgId: tenantId }, data: { status: p.status, value: p.value, ownerId: p.ownerId } });
  },
},
```

Rules:

- **Always filter by `tenantId`**, in reads and in writes. Never take a company id from the arguments.
- Treat arguments as untrusted input: check types, allow only the fields the action list describes, cap list sizes. Throw an `Error` with a plain message when something's wrong ("No lead with that id."); Utter reads it out.
- If the app has roles, check that `userId` may do this, the same way the app's own API does.
- Return plain JSON that matches `types`. Reuse the app's existing service functions where they exist, so its own rules (validation, audit logs, webhooks) still apply.

## 4. Sign-in: getViewer and isMember

```ts
// Is this person part of this company? Utter only acts as real members.
isMember: async (tenantId, userId) => Boolean(await db.membership.findFirst({ where: { orgId: tenantId, userId } })),

// Who is signed in, from the request, with the app's own login. null when nobody is.
getViewer: async (req) => {
  const session = await auth();               // whatever the app already uses
  if (!session?.user) return null;
  return {
    tenant: { id: session.user.orgId, name: session.user.orgName },
    user: { id: session.user.id, name: session.user.name ?? session.user.email, title: session.user.role },
  };
},
```

Use the app's existing helper for the current user. `getViewer` receives the standard `Request`, so cookie- or header-based logins work too. The user's name and title help Utter talk naturally ("assign it to me").

## 5. Put the button on screen

Once, in the signed-in layout, in a client component:

```tsx
"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Utter, CHANGED_EVENT } from "utter-sdk/react";

export function UtterButton() {
  const router = useRouter();
  // After Utter changes something, reload the page's data so the change shows.
  useEffect(() => {
    const refresh = () => router.refresh();
    window.addEventListener(CHANGED_EVENT, refresh);
    return () => window.removeEventListener(CHANGED_EVENT, refresh);
  }, [router]);
  return <Utter app="Acme CRM" examples={["Which deals close this month?", "Move my stale leads to Cold"]} />;
}
```

- Write two or three `examples` that fit this app and work with the actions you listed.
- If pages load data on the client (SWR, React Query), refresh those instead of `router.refresh()` (for example `mutate()` or `queryClient.invalidateQueries()`).
- The button stays hidden until the owner switches Utter on in the dashboard, so it's safe to deploy first.
- Match the app's look with CSS variables on a parent: `--utter-accent`, `--utter-accent-ink`, `--utter-bg`, `--utter-ink`, `--utter-muted`, `--utter-line`, `--utter-soft`. `position="bottom-left"` moves it. Or build your own with the hooks `useUtter()`, `useVoice()` and `useUtterStatus()`.

## 6. Check it

1. Typecheck or build the app.
2. Start the app and run `npx utter-sdk check`. It reads the keys from the env file, fetches the action list from the running app with a signed request, and checks it. Add `--app http://localhost:3001` if the app runs elsewhere, and `--tenant <id> --user <id>` (a real company and one of its members) to also run each reading action whose arguments are all optional.
3. Fix whatever it reports and run it again.

## 7. Hand back

Tell the developer, briefly:

- what Utter can read and change (the actions), and anything you left out on purpose
- which files you changed
- that Utter calls the app at the address set in the dashboard, so it must be public (https) for production; for local testing, a tunnel works
- that they switch it on in the Utter dashboard (app.utter.talk/dashboard), where the checklist shows what's left, then try it themselves: press the button and say one of the examples

Docs: https://app.utter.talk/docs · Setup guide: https://app.utter.talk/setup
