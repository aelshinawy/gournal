Import the old `entries.json` file. This example ran in a journal folder that holds a 0.x `entries.json` with two entries. The first line is a note that gournal prints when it opens the folder. The second line is the result of the command.

```console
$ gournal migrate
gournal: imported 2 entries from entries.json
Imported 0 entries (2 already present).
```

Run the command again. The entries are already in the database.

```console
$ gournal migrate
Imported 0 entries (2 already present).
```
