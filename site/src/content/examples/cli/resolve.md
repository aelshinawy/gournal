Resolve an open blocker. Pass the short id from the standup report. The entry then leaves the Blockers list.

```console
$ gournal standup -p billing-api

Standup: Today (2026-11-15)

  Done
  billing-api
  23:28  Add keyboard focus styles to the invoice date picker
  23:28  Fix rounding error in invoice totals
  23:28  Document the invoice export endpoint

  Blockers
    Nov 15  CZJBZWY7  Cannot reproduce the failing webhook retry in staging  [billing-api]

  Next
    Nov 15  VN86G0RV  Add a regression test for tax rounding  [billing-api]

$ gournal resolve CZJBZWY7
✓ Resolved: Cannot reproduce the failing webhook retry in staging

$ gournal standup -p billing-api

Standup: Today (2026-11-15)

  Done
  billing-api
  23:28  Add keyboard focus styles to the invoice date picker
  23:28  Fix rounding error in invoice totals
  23:28  Document the invoice export endpoint

  Next
    Nov 15  VN86G0RV  Add a regression test for tax rounding  [billing-api]
```
