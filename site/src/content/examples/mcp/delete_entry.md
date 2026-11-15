Delete an entry. The entry stays in the database. The text result tells you the command that restores it.

```json
{
  "id": "1QGS52KG"
}
```

The text result:

```text
Entry 1QGS52KG deleted: Draft the release notes for 2.4
restore with gournal restore 1QGS52KG
```

The structured result has the same shape as the `add_entry` result. The `deletedAt` field holds the time of the deletion.

```json
{
  "entry": {
    "id": "01M7G81WDZ12AE5Q5X1QGS52KG",
    "createdAt": "2026-11-15T18:38:29.311Z",
    "updatedAt": "2026-11-15T18:39:12.024Z",
    "deletedAt": "2026-11-15T18:39:12.024Z",
    "summary": "Draft the release notes for 2.4",
    "kind": "done",
    "project": "billing-api",
    "tags": [
      "docs"
    ],
    "refs": "..."
  },
  "notes": []
}
```
