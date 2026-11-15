Resolve an open blocker. Pass the short id from the standup report. The entry then leaves the Blockers list.

```console
$ gournal resolve HTMQYBQ9
✓ Resolved: Cannot reproduce the failing webhook retry in staging

$ gournal standup -p billing-api

Standup: Today (2026-11-15)

  Done
  billing-api
  20:38  Fix rounding error in invoice totals

  Next
    Nov 15  3X0XK8AQ  Add a regression test for tax rounding  [billing-api]
```
