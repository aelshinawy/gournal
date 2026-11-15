Resolve an open blocker. Pass the short id from the standup report. The entry then leaves the Blockers list.

```console
$ gournal standup -p billing-api

Standup: Today (2026-11-15)

  Done
  billing-api
  23:18  Fix rounding error in invoice totals
  23:18  Document the invoice export endpoint
  23:18  Add keyboard focus styles to the invoice date picker

  Blockers
    Nov 15  4XEG1TD4  Cannot reproduce the failing webhook retry in staging  [billing-api]

  Next
    Nov 15  27GTPX08  Add a regression test for tax rounding  [billing-api]

$ gournal resolve 4XEG1TD4
✓ Resolved: Cannot reproduce the failing webhook retry in staging

$ gournal standup -p billing-api

Standup: Today (2026-11-15)

  Done
  billing-api
  23:18  Fix rounding error in invoice totals
  23:18  Document the invoice export endpoint
  23:18  Add keyboard focus styles to the invoice date picker

  Next
    Nov 15  27GTPX08  Add a regression test for tax rounding  [billing-api]
```
