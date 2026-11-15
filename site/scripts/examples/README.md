# Example recording

Every example in `site/src/content/examples/` comes from one seeded journal.
The seed holds 8 entries: 5 in `billing-api` and 3 in `worker`.
The tags are `review` (3), `ui` (3), and `docs` (2).
The journal has one open blocker and one open next item, both in `billing-api`.
The entry ids are random ULIDs. The counts stay the same.
The test `test/docs-examples.test.ts` checks that the counts agree across pages.

## Order

1. Run `npm run build`.
2. Make an empty temp folder. Never use `~/.gournal`.
3. Seed it: `node -r ts-node/register/transpile-only site/scripts/examples/seed.ts <dir>`.
4. Set `HOME` and `GOURNAL_HOME` to `<dir>`. Set `GOURNAL_NO_AUTOSYNC=1`.
5. Run the read-only commands in `<dir>/dev/billing-api` against the seed: `projects`, `tags`, `log`, `standup`, `stats`, `find`, `export`, `index rebuild`.
6. Copy the seed folder again for each command that changes state. Run it in the copy. These are `add`, `resolve`, `undo`, `restore`, `clear`, `import`, `sync`, `setup claude`, and every MCP write tool.
7. Run `migrate` in an empty folder that holds a 0.x `entries.json` with two entries.
8. Run `sync` with `GOURNAL_GH` set to a stand-in gh program that prints fixture data.
9. Run `setup claude` with a `PATH` that has no `claude` program. Link `gournal` into that `PATH`.
10. Record MCP output from in-process calls. Use the client pattern in `test/mcp.test.ts`.
11. Replace the temp home path with `/Users/you` in the text. Keep every other value from the run.
12. Run `npm run docs:gen`.
