# Changelog

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
