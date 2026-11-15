Find entries that match a word.

```console
$ gournal find rounding
Found 2 entries:

Nov Sun 15 - 22:05 757FDB8A [billing-api] Fix rounding error in invoice totals #review
Nov Sun 15 - 23:43 48HE4S3P [billing-api] Add a regression test for tax rounding #review
```

Combine the search with filters. This command finds open blockers only.

```console
$ gournal find webhook --kind blocker --status open
Found 1 entries:

Nov Sun 15 - 23:29 ZY40X9DE [billing-api] Cannot reproduce the failing webhook retry in staging 
```
