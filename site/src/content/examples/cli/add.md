Add an entry. Gournal prints the short id of the new entry.

```console
$ gournal add "Fix rounding error in invoice totals" -t bugfix,invoices -d "Totals were off by one cent when a discount applied after tax."
✓ Entry added! (53X22ZXF)
```

Add a blocker or a next item with `--kind`. Gournal takes the project, repo, and branch from the current directory.

```console
$ gournal add "Cannot reproduce the failing webhook retry in staging" -k blocker -t webhooks
✓ Entry added! (0MC5VPCQ)

$ gournal add "Add a regression test for tax rounding" -k next -t testing,invoices
✓ Entry added! (V91XZBEK)
```
