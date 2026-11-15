Show today's standup. The report lists done entries by project, then open blockers and next items.

```console
$ gournal standup

Standup: Today (2026-11-15)

  Done
  billing-api
  22:05  Fix rounding error in invoice totals
  22:19  Add keyboard focus styles to the invoice date picker
  22:33  Document the invoice export endpoint

  worker
  22:47  Move the settings page to the new form components
  23:01  Document the retry policy for webhooks
  23:15  Review the queue backoff change

  Blockers
    Nov 15  ZY40X9DE  Cannot reproduce the failing webhook retry in staging  [billing-api]

  Next
    Nov 15  48HE4S3P  Add a regression test for tax rounding  [billing-api]
```
