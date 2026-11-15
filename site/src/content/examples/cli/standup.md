Show today's standup. The report lists done entries by project, then open blockers and next items.

```console
$ gournal standup

Standup: Today (2026-11-15)

  Done
  billing-api
  23:18  Fix rounding error in invoice totals
  23:18  Document the invoice export endpoint
  23:18  Add keyboard focus styles to the invoice date picker

  worker
  23:18  Review the queue backoff change
  23:18  Document the retry policy for webhooks
  23:18  Move the settings page to the new form components

  Blockers
    Nov 15  4XEG1TD4  Cannot reproduce the failing webhook retry in staging  [billing-api]

  Next
    Nov 15  27GTPX08  Add a regression test for tax rounding  [billing-api]
```
