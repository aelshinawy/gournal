Show today's standup. The report lists done entries by project, then open blockers and next items.

```console
$ gournal standup

Standup: Today (2026-11-15)

  Done
  billing-api
  23:28  Add keyboard focus styles to the invoice date picker
  23:28  Fix rounding error in invoice totals
  23:28  Document the invoice export endpoint

  worker
  23:28  Move the settings page to the new form components
  23:28  Review the queue backoff change
  23:28  Document the retry policy for webhooks

  Blockers
    Nov 15  CZJBZWY7  Cannot reproduce the failing webhook retry in staging  [billing-api]

  Next
    Nov 15  VN86G0RV  Add a regression test for tax rounding  [billing-api]
```
