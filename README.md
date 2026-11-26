<img src="https://raw.githubusercontent.com/uttertalk/brand/main/cover.png" alt="Utter: the voice button for your product">

# utter-sdk

[![npm](https://img.shields.io/npm/v/utter-sdk?color=3341ff&labelColor=eceeff)](https://www.npmjs.com/package/utter-sdk)
![Node](https://img.shields.io/badge/node-18%2B-3341ff?labelColor=eceeff)
![React](https://img.shields.io/badge/react-18%2B-3341ff?labelColor=eceeff)
![License: MIT](https://img.shields.io/badge/license-MIT-3341ff?labelColor=eceeff)
[![Tests](https://github.com/uttertalk/sdk/actions/workflows/test.yml/badge.svg)](https://github.com/uttertalk/sdk/actions/workflows/test.yml)

[Website](https://www.utter.talk) · [Live demo](https://demo.utter.talk/try) · [Setup guide](https://app.utter.talk/setup) · [Docs](https://app.utter.talk/docs) · [Example app](https://github.com/uttertalk/example-app) · [Status](https://www.utter.talk/status)

The voice button for your product. Your users press the mic (or type) and say what they want. Utter does it inside
your app, as them, with only the actions you allow, and answers out loud. Anything that changes data waits for a yes.

## Quick setup

```
npx utter-sdk init
```

Signs you in through the browser, saves the keys in `.env.local`, installs this package, creates `lib/utter.ts` and
the route, and adds an Utter skill for Claude Code, Codex and Cursor. Then ask your coding agent:
"Set up Utter in this app. Follow the utter skill." Check it with `npx utter-sdk check`, add your own Claude or Gemini
key in the dashboard, and switch Utter on.

The full guide, with the exact prompts to give your AI: https://app.utter.talk/setup

The steps below are the same setup by hand.

```
npm install utter-sdk
```

## 1. Settings

Create a project at https://app.utter.talk/signup to get these. Keep the secret on your server.

```
UTTER_PROJECT=your-project   # your project id
UTTER_SECRET=...             # signs every request between you and Utter
# UTTER_URL=...              # only if you use a different Utter address
```

## 2. The action list and the route

```ts
// lib/utter.ts
import { createUtter } from "utter-sdk/server";

export const utter = createUtter({
  manifest: {
    app: "Acme CRM",
    description: "A CRM for small sales teams.",
    types: "type Lead = { id: string; name: string; value: number; status: string; ownerId: string | null }",
    actions: [
      { name: "leads.list", description: "All leads", args: "()", returns: "Lead[]" },
      { name: "leads.update", description: "Change a lead", args: "(id: string, patch: { status?: string })", returns: "Lead", writes: true },
    ],
  },
  // Your own functions, run for one customer company (tenantId) and one person (userId).
  actions: {
    "leads.list": ({ tenantId }) => db.leads.findMany({ where: { tenantId } }),
    "leads.update": ({ tenantId }, id, patch) => db.leads.update({ where: { id, tenantId }, data: patch }),
  },
  isMember: (tenantId, userId) => db.members.exists({ tenantId, userId }),
  getViewer: async (req) => {
    const user = await getSignedInUser(req);
    return user && { tenant: { id: user.companyId, name: user.companyName }, user: { id: user.id, name: user.name } };
  },
});
```

```ts
// app/api/utter/[...path]/route.ts
import { utter } from "@/lib/utter";
export const { GET, POST } = utter.handler;
```

- Reading actions run right away. Actions with `writes: true` only run after the person says yes to a plan listing
  every change.
- Every call from Utter is signed with your secret and checked here. Utter only acts as people `isMember` accepts,
  inside their own company.

## 3. The button

```tsx
"use client";
import { Utter } from "utter-sdk/react";

<Utter app="Acme CRM" examples={["Which deals close this month?", "Move my stale leads to Cold"]} />
```

Put it once in your signed-in layout. It stays hidden until you switch Utter on in the dashboard. Before that, only testers you pick there can see it.

After Utter changes something, the page gets a `utter:changed` event; refresh your data on it:

```ts
window.addEventListener("utter:changed", () => router.refresh());
```

Options: `app`, `examples`, `position` (`"bottom-right"` or `"bottom-left"`), `voice` (`false` to never speak),
`lang`, `basePath`. Colours: set `--utter-accent`, `--utter-accent-ink`, `--utter-bg`, `--utter-ink`,
`--utter-muted`, `--utter-line`, `--utter-soft` on a parent.

Your own look instead: `useUtter()` (turns, send, confirm, cancel), `useVoice()` (listen, speak),
`useUtterStatus()` and `useLook()`. Pass `useUtter({ page: true })` and call `useLook({ enabled: status.looks })` to
let people change their own look.

People can also change how your app looks for themselves: "make it dark", "bigger text", "hide the Source column".
Utter writes a style sheet for that one person and the button applies it on every page, on every device. It's styling
only, never data. To write it, the button sends an outline of the page (headings, labels, buttons, menu links and
column headers, never what's in table cells or form fields). Switch it off in the dashboard if you don't want it. After
a change the page gets a `utter:look` event.

Voice uses the browser's own speech: listening works in Chrome, Edge and Safari; in other browsers the mic hides and
typing still works.

## 4. Check it

```
npx utter-sdk check --app http://localhost:3000 --tenant <company id> --user <user id>
```

Checks the keys, reads your action list the way Utter does, and runs each reading action for that company and person.

## How it works

1. A signed-in person presses the button and speaks (or types). The browser turns speech into text.
2. The button sends it to your route. Your route knows who is signed in through your login, and passes the request
   on to Utter with a one-hour session for that person.
3. Utter's AI reads your action list and runs reading actions right away, by calling your app back with a signed
   request, as that person, inside their company.
4. Actions that change data are never run at that point. Utter returns a plan listing every change, signed for that
   person, and they say yes or no.
5. On yes, Utter runs exactly those steps, once, and says what happened. Every request is logged in your dashboard.

Every prompt Utter's AI is told and every rule above is public in [uttertalk/brain](https://github.com/uttertalk/brain).

## Roadmap

Planned, not built yet:

- **Instant voice-to-voice**: answers in under half a second, with a natural voice you can interrupt
- **Every language**: talk to your app in 50+ languages and accents
- **Learns your app on its own**: no action list to write
- **Native mobile**: the same button in iOS and Android apps
- **Every backend**: server packages for Python, Ruby, Go, Java and PHP, next to Node

The full list, and how to help fund it, is on the [Utter GitHub page](https://github.com/uttertalk).

## Development

```
npm install
npm test     # builds, then runs the tests against a fake Utter; no key needed
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
