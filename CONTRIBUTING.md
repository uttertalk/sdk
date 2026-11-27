# Contributing

Thanks for helping make apps you can just talk to.

## Reporting a bug

Open an [issue](https://github.com/uttertalk/sdk/issues/new/choose) with:

- what you said or typed, or what you ran
- what you expected and what happened instead
- your Node, React, framework and browser versions

Leave out your project secret and anything from your users' data. For security problems, use a private report instead (see [SECURITY.md](SECURITY.md)).

## Suggesting a change

Open an issue first for anything bigger than a small fix, so we can agree on the approach before you write code.

## Making a pull request

```bash
git clone https://github.com/uttertalk/sdk.git
cd sdk
npm install
npm test
```

- Keep pull requests small and focused on one thing.
- `npm test` must pass. It builds the package with no type errors, then runs the tests against a fake Utter, so it needs no key.
- If you change how calls are signed or checked in `src/server.ts`, add a test for it in `test/server.test.mjs` and say why in the pull request.
- Add a line to [CHANGELOG.md](CHANGELOG.md) under a new "Unreleased" heading.

By contributing, you agree that your contribution is licensed under the same [license](LICENSE) as the project.
