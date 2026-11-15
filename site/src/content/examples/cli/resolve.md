Resolve an open blocker. Pass the short id from the standup report. The entry then leaves the Blockers list.

```console
$ gournal standup -p billing-api

Standup: Today (2026-11-15)

  Done
  billing-api
  23:25  Fix rounding error in invoice totals
  23:25  Add keyboard focus styles to the invoice date picker
  23:25  Document the invoice export endpoint

  Blockers
    Nov 15  G7Z7E298  Cannot reproduce the failing webhook retry in staging  [billing-api]

  Next
    Nov 15  RMGKJSHY  Add a regression test for tax rounding  [billing-api]

$ gournal resolve G7Z7E298
✓ Resolved: Cannot reproduce the failing webhook retry in staging

$ gournal standup -p billing-api

Standup: Today (2026-11-15)

  Done
  billing-api
  23:25  Fix rounding error in invoice totals
  23:25  Add keyboard focus styles to the invoice date picker
  23:25  Document the invoice export endpoint

  Next
    Nov 15  RMGKJSHY  Add a regression test for tax rounding  [billing-api]
```
