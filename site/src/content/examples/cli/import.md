Make a bundle file, then load it into another journal. This example imports into an empty journal.

```console
$ gournal export -f bundle -o backup.json
✓ Exported 6 entries to backup.json

$ gournal import backup.json
Imported: 6 new, 0 updated, 0 unchanged, 0 duplicates merged.
```

Import the same file again. Gournal finds the same entries and changes nothing.

```console
$ gournal import backup.json
Imported: 0 new, 0 updated, 6 unchanged, 0 duplicates merged.
```
