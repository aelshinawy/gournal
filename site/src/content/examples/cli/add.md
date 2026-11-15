Add an entry. Gournal prints the short id of the new entry.

```console
$ gournal add "Fix the stale totals in the invoice PDF" -t review,docs -d "The PDF showed the total before the discount."
✓ Entry added! (H6AZF0HY)
```

Add a blocker or a next item with `--kind`. Gournal takes the project, repo, and branch from the current directory.

```console
$ gournal add "Cannot reproduce the failing PDF render in staging" -k blocker -t review
✓ Entry added! (KXBS99RF)

$ gournal add "Add a regression test for PDF totals" -k next -t review,docs
✓ Entry added! (3SS4M21S)
```
