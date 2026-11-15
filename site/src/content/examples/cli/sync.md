Fetch GitHub activity through the gh CLI. This example uses a stand-in gh program with fixture data for the `acme` and `octo` owners.

```console
$ gournal sync --since 2026-11-01
Synced GitHub activity since Nov 01: 4 new, 0 updated, 3 links.
```

After an earlier sync worked, a later sync without a working gh CLI reports why it stopped. A new user who never synced sees `GitHub sync failed (gh is not installed; see https://cli.github.com)` instead.

```console
$ gournal sync
Synced GitHub activity since Nov 15: 0 new, 0 updated, 0 links. Stopped early (gh is not installed; see https://cli.github.com); run gournal sync again to continue.
```
