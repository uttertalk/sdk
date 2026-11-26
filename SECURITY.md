# Security

## Reporting a problem

Use **[Report a vulnerability](https://github.com/uttertalk/sdk/security/advisories/new)** on this repo, or email **hello@utter.talk**. Both are private. Please include what you found, how to reproduce it, and what someone could do with it. Don't open a public issue for a security problem.

We reply within 3 working days and keep you posted until it's fixed. If you'd like credit, we'll name you in the changelog.

This covers the code in this repo and the Utter service at [app.utter.talk](https://app.utter.talk). How the service handles data is on its [privacy page](https://www.utter.talk/privacy).

## How this package handles your data

- **Your project secret** is read from `UTTER_SECRET` (or the `secret` option) and only used to sign and check calls. It's never sent anywhere or logged.
- **Calls from Utter** must carry a valid signature over the exact request body and a timestamp less than 5 minutes old, or they're turned away.
- **Actions** only run if they're on your action list and in your `actions`, for a company and person that `isMember` says belong together.
- **Changes** (actions with `writes: true`) are only ever run by Utter after the person confirmed a plan that Utter signed for them; the plan expires after 5 minutes and runs once.
- **Your database and code** never leave your server. Utter only gets what your actions return.
- **Speech** is turned into text by the browser's own speech recognition, and replies are spoken by the browser. The package sends no audio anywhere.
- **Nothing else is sent anywhere.** There's no tracking in this package.
