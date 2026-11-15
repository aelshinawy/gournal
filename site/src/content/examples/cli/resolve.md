Resolve an open blocker. Pass the short id from the standup report. The entry then leaves the Blockers list.

```console
$ gournal standup -p billing-api

Standup: Today (2026-11-15)

  Done
  billing-api
  22:05  Fix rounding error in invoice totals
  22:19  Add keyboard focus styles to the invoice date picker
  22:33  Document the invoice export endpoint

  Blockers
    Nov 15  ZY40X9DE  Cannot reproduce the failing webhook retry in staging  [billing-api]

  Next
    Nov 15  48HE4S3P  Add a regression test for tax rounding  [billing-api]

$ gournal resolve ZY40X9DE
✓ Resolved: Cannot reproduce the failing webhook retry in staging

$ gournal standup -p billing-api

Standup: Today (2026-11-15)

  Done
  billing-api
  22:05  Fix rounding error in invoice totals
  22:19  Add keyboard focus styles to the invoice date picker
  22:33  Document the invoice export endpoint

  Next
    Nov 15  48HE4S3P  Add a regression test for tax rounding  [billing-api]
```
