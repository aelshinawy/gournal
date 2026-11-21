# Example recording

Every example in `site/src/content/examples/` comes from one seeded journal.
The seed holds 8 entries: 5 in `billing-api` and 3 in `worker`.
The tags are `review` (3), `ui` (3), and `docs` (2).
The journal has one open blocker and one open next item, both in `billing-api`.
The entry ids are random ULIDs. The counts stay the same.
The test `test/docs-examples.test.ts` checks that the counts agree across pages.

## Requirements

- A built `dist/` (run `npm run build`).
- A POSIX shell.
- Git 2.28 or newer, for `git init -b`.
- macOS or Linux. Windows does not work.

## Record

Do not record within 2 hours of midnight, because times are relative to now.
The page `cli/mcp.md` is hand-written. The recorder does not touch it.

1. Run `npm run build`.
2. Run `node -r ts-node/register/transpile-only site/scripts/examples/record.ts`.
3. Read the printed examples. The script saves them in a staging folder under a temp dir. Pass `--work <dir>` to choose the folder. The folder must be new or empty.
4. Pass `--write` to replace the files in `site/src/content/examples/`.
4. Run `npm run docs:gen`.

The script refuses to work in the real home or in `~/.gournal`. It always sets `HOME` and `GOURNAL_HOME` to a temp copy.

## What the script does, in order

1. Seeds a temp journal with `seed.ts`. The seed adds a `pr` ref for PR 412 to the first `billing-api` entry.
2. Runs the read-only commands in `<dir>/dev/billing-api`: `projects`, `tags`, `log`, `index rebuild`, `standup`, `stats`, `find`, `export`.
3. Copies the seed again for each command that changes state: `add`, `resolve`, `undo`, `restore`, `clear`, `import`, `sync`, `setup claude`. Each runs in its own copy.
4. Runs `sync` with `GOURNAL_GH` set to `fake-gh.js`, a committed stand-in gh program. PR 412 in `acme/billing-api` links to the seed entry.
5. Runs `setup claude` with a `PATH` of only the scratch folder (a `gournal` link and a `node` link) and the system folders, so no `claude` program is found.
6. Makes the MCP calls in process, with the client pattern of `test/mcp.test.ts`.
7. Replaces the temp home path with `/Users/you`. Every other value stays as the run printed it.
