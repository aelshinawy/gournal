Find entries that match a word.

```console
$ gournal find rounding
Found 2 entries:

Nov Sun 15 - 23:25 HXVH4GZD [billing-api] Fix rounding error in invoice totals #review
Nov Sun 15 - 23:25 RMGKJSHY [billing-api] Add a regression test for tax rounding #review
```

Combine the search with filters. This command finds open blockers only.

```console
$ gournal find webhook --kind blocker --status open
Found 1 entries:

Nov Sun 15 - 23:25 G7Z7E298 [billing-api] Cannot reproduce the failing webhook retry in staging 
```
