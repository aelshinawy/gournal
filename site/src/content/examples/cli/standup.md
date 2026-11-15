Show today's standup. The report lists done entries by project, then open blockers and next items.

```console
$ gournal standup

Standup: Today (2026-11-15)

  Done
  billing-api
  23:25  Fix rounding error in invoice totals
  23:25  Add keyboard focus styles to the invoice date picker
  23:25  Document the invoice export endpoint

  worker
  23:25  Move the settings page to the new form components
  23:25  Document the retry policy for webhooks
  23:25  Review the queue backoff change

  Blockers
    Nov 15  G7Z7E298  Cannot reproduce the failing webhook retry in staging  [billing-api]

  Next
    Nov 15  RMGKJSHY  Add a regression test for tax rounding  [billing-api]
```
