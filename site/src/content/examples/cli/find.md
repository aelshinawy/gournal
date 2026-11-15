Find entries that match a word.

```console
$ gournal find rounding
Found 2 entries:

Nov Sun 15 - 23:28 66CE7C23 [billing-api] Fix rounding error in invoice totals #review
Nov Sun 15 - 23:28 VN86G0RV [billing-api] Add a regression test for tax rounding #review
```

Combine the search with filters. This command finds open blockers only.

```console
$ gournal find webhook --kind blocker --status open
Found 1 entries:

Nov Sun 15 - 23:28 CZJBZWY7 [billing-api] Cannot reproduce the failing webhook retry in staging 
```
