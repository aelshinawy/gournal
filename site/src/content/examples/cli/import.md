Make a bundle file, then load it into another journal. Set `GOURNAL_HOME` to the folder of the other journal. This example imports into an empty journal.

```console
$ gournal export -f bundle -o backup.json
✓ Exported 8 entries to backup.json

$ GOURNAL_HOME=~/other-journal gournal import backup.json
Imported: 8 new, 0 updated, 0 unchanged.
```

Import the same file again into that journal. Gournal finds the same entries and changes nothing.

```console
$ GOURNAL_HOME=~/other-journal gournal import backup.json
Imported: 0 new, 0 updated, 8 unchanged.
```
