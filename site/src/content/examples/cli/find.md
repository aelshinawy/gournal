Find entries that match a word.

```console
$ gournal find rounding
Found 2 entries:

Nov Sun 15 - 16:04 53X22ZXF [billing-api] Fix rounding error in invoice totals #bugfix #invoices
Nov Sun 15 - 16:04 V91XZBEK [billing-api] Add a regression test for tax rounding #testing #invoices
```

Combine the search with filters. This command finds open blockers only.

```console
$ gournal find webhook --kind blocker --status open
Found 1 entries:

Nov Sun 15 - 16:04 0MC5VPCQ [billing-api] Cannot reproduce the failing webhook retry in staging #webhooks
```
