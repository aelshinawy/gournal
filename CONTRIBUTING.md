# Contributing to gournal

Thank you for your interest. This page tells you how to set up the project and what a pull request needs.

## Requirements

- Node.js 22.13 or newer.
- Git 2.7 or newer.

## Set up

```bash
npm ci
```

## Check your change

Run these commands before you open a pull request. CI runs the same checks.

```bash
npm run build
npm run lint
npm run typecheck
npm test
npm run test:ci
npm run check:dashes
```

- `npm run build` compiles the TypeScript sources.
- `npm run lint` checks the layer rules (see below).
- `npm run typecheck` checks the types of the sources and of the tests.
- `npm test` runs the Jest tests.
- `npm run test:ci` runs the Jest tests with the coverage threshold. CI runs this command.
- `npm run check:dashes` fails when README.md or site/src contains the em dash character. Use a comma, a colon, parentheses, or a new sentence instead.

## Layer rules

The code in `src/` has layers. A layer imports only from the layers below it.

1. `core`: pure logic. It does no I/O and imports no Node built-in modules.
2. `storage` and `sources`.
3. `render`.
4. `adapters`.

Two more rules apply:

- `storage` and `sources` do not import each other.
- Code imports another layer only through the `index.ts` of that layer.

`npm run lint` runs dependency-cruiser and enforces these rules. The rules are in `.dependency-cruiser.cjs`.

## Reference docs

The reference pages in `site/src/content/docs/docs/reference` come from the source code. A generator writes them. Run it after you change a command, an option, a config key, or an MCP tool:

```bash
npm run docs:gen
```

Commit the generated pages. The Site workflow runs the generator and fails when a page is out of date. This check keeps the docs equal to the code.

To build the docs site, run `npm --prefix site ci` and then `npm --prefix site run build`.

## Tests

CI runs the tests on Linux, macOS, and Windows. A test must not assume POSIX paths or a POSIX shell. Build paths with `path`, and use `pathToFileURL` from `url` to make file URLs. Use the helpers in `test/helpers`, for example `asPlatform`, to pin the platform that a test names. `asPlatform` works for a synchronous function only.

A change in behavior needs a test. A bug fix needs a test that fails without the fix. Use neutral fixture names such as `acme/widgets`. Do not use real company names, real paths, or real journal data in tests.

## Run the CLI by hand

Use a temporary home folder. This step protects your own journal.

```bash
export HOME=$(mktemp -d) GOURNAL_HOME=$(mktemp -d)
```

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/). Examples:

- `fix(storage): name the home path when the database cannot be written`
- `docs(find): say that matching differs between Node builds`
- `feat(cli): add a new option`

Write short sentences. Use active voice.

## Pull requests

1. Branch from `main`.
2. Keep each pull request to one change.
3. Run the checks above.
4. Fill in the pull request template.

## Security

Do not report a vulnerability in an issue or a pull request. Read [SECURITY.md](SECURITY.md).
