Remove the last entry that you added on this device. The command prints the id that restores it.

```console
$ gournal add "Draft the release notes for 2.4" -t docs
✓ Entry added! (JGMXAJBK)

$ gournal undo
✓ Removed: Draft the release notes for 2.4 (restore with gournal restore JGMXAJBK)
```
