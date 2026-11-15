Resolve an open blocker. Pass the short id from the standup report. The entry then leaves the Blockers list.

```console
$ gournal standup -p billing-api

Standup: Today (2026-11-15)

  Done
  billing-api
  20:38  Fix one-cent rounding error in invoice totals

  Blockers
    Nov 15  T30MA11H  Staging deploy fails on the invoice migration  [billing-api]

$ gournal resolve T30MA11H
✓ Resolved: Staging deploy fails on the invoice migration

$ gournal standup -p billing-api

Standup: Today (2026-11-15)

  billing-api
  20:38  Fix one-cent rounding error in invoice totals
```
