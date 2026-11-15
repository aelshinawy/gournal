Remove the last entry that you added on this device. The command prints the id that restores it.

```console
$ gournal add "Draft the release notes for 2.4" -t docs
✓ Entry added! (4MG0CWFA)

$ gournal undo
✓ Removed: Draft the release notes for 2.4 (restore with gournal restore 4MG0CWFA)
```
