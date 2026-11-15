Fetch GitHub activity through the gh CLI. This example uses a stand-in gh program with fixture data for the `acme` and `octo` owners.

```console
$ gournal sync --since 2026-11-01
Synced GitHub activity since Nov 01: 4 new, 0 updated, 0 links.
```

Without a working gh CLI, the command reports why it stopped.

```console
$ gournal sync
Synced GitHub activity since Nov 15: 0 new, 0 updated, 0 links. Stopped early (gh is not installed; see https://cli.github.com); run gournal sync again to continue.
```
