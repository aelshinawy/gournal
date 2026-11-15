# Example recording

Every example in `site/src/content/examples/` comes from one seeded journal.
The seed holds 8 entries: 5 in `billing-api` and 3 in `worker`.
The tags are `review` (3), `ui` (3), and `docs` (2).
The journal has one open blocker and one open next item, both in `billing-api`.
The entry ids are random ULIDs. The counts stay the same.
The test `test/docs-examples.test.ts` checks that the counts agree across pages.

## Record

1. Run `npm run build`.
2. Run `node -r ts-node/register/transpile-only site/scripts/examples/record.ts`.
3. Read the printed examples. The script saves them in a staging folder under a temp dir. Pass `--work <dir>` to choose the folder.
4. Pass `--write` to replace the files in `site/src/content/examples/`.
5. Run `npm run docs:gen`.

The script refuses to work in the real home or in `~/.gournal`. It always sets `HOME` and `GOURNAL_HOME` to a temp copy.

## What the script does, in order

1. Seeds a temp journal with `seed.ts`. The seed adds a `pr` ref for PR 412 to the first `billing-api` entry.
2. Runs the read-only commands in `<dir>/dev/billing-api`: `projects`, `tags`, `log`, `index rebuild`, `standup`, `stats`, `find`, `export`.
3. Copies the seed again for each command that changes state: `add`, `resolve`, `undo`, `restore`, `clear`, `import`, `sync`, `setup claude`. Each runs in its own copy.
4. Runs `migrate` in an empty folder that holds a 0.x `entries.json` with two entries.
5. Runs `sync` with `GOURNAL_GH` set to `fake-gh.js`, a committed stand-in gh program. PR 412 in `acme/billing-api` links to the seed entry.
6. Runs `setup claude` with a `PATH` that has no `claude` program and a `gournal` link.
7. Makes the MCP calls in process, with the client pattern of `test/mcp.test.ts`.
8. Replaces the temp home path with `/Users/you`. Every other value stays as the run printed it.
