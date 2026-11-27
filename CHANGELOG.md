# Changelog

## 0.2.2

- **Recolouring works.** The page outline now starts with the page's colours: its background, its text and the app's colour variables (like `--brand: #3341ff`). "Make it green" now changes the colours themselves, instead of the AI guessing a colour shift that could land on the wrong colour.

## 0.2.1

- No code changes. The README, the package description and the agent skill now describe Utter the way the site does: your users ask, and your app changes for them, with their own look and the work done for them.

## 0.2.0

- **People can change how your app looks, for themselves.** "Make it dark", "bigger text", "hide the Source column": Utter's AI writes a style sheet for that one person, and `<Utter />` applies it on every page, on every device they use. "Undo that" and "reset my look" always work. Styling only: it never changes data or what your app can do. Switch it off in the dashboard if you don't want it.
- To write it, the button sends Utter an outline of the page with each request: tags, classes, and the words on headings, labels, buttons, menu links and column headers. Never what's in table cells or form fields.
- A look that would hide the Utter button is undone right away, so people can't lock themselves out.
- New: `useLook()`, `applyLook()`, `pageOutline()`, the `utter:look` event, `useUtter({ page: true })`, and `looks` in `useUtterStatus()`. Your route passes the new `look` and `undo-look` requests on to Utter by itself.

## 0.1.1

- **Colours set on a parent now work.** The button's default colours are fallbacks, so `--utter-accent` and the other variables can be set on any parent element, as the docs say. Before, the defaults on the button itself won over them.

## 0.1.0

First release.

- **`createUtter`** connects your server: the action list, your action functions, `isMember` and `getViewer`, and one route (`utter.handler`) for Utter's signed calls and your screens.
- **`<Utter />`**: a floating mic button and panel. People talk or type; Utter answers out loud and on screen. Changes are listed and wait for a yes (by voice or button). Hidden until switched on in the dashboard. Themed with `--utter-*` CSS variables.
- **Hooks** for your own look: `useUtter()`, `useVoice()`, `useUtterStatus()`, and `yesOrNo()`.
- **`utter:changed`** event after a confirmed change, so your screens can refresh.
- **`npx utter-sdk init`** signs you in through the browser, saves the keys in `.env.local` (and keeps it out of git), installs the package, creates `lib/utter.ts` and the route, and adds an Utter skill for Claude Code, Codex and Cursor.
- **`npx utter-sdk check`** checks your keys and your running app's action list, and with `--tenant` and `--user` runs each reading action.
- 35 tests: signatures, expiry, allowed actions, company membership, sessions, browser routes and the CLI helpers.
