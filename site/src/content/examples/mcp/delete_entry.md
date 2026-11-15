Delete an entry. The entry stays in the database. The text result tells you the command that restores it.

```json
{
  "id": "BREW8H23"
}
```

The text result:

```text
Entry BREW8H23 removed: Document the invoice export endpoint
restore with gournal restore BREW8H23
```

The structured result has the same shape as the `add_entry` result. The `deletedAt` field holds the time of the deletion.

```json
{
  "entry": {
    "id": "01M7GHKAPYGCB9VB4GBREW8H23",
    "createdAt": "2026-11-15T21:25:18.174Z",
    "updatedAt": "2026-11-15T21:25:23.839Z",
    "deletedAt": "2026-11-15T21:25:23.839Z",
    "deviceId": "01M7GHKAPQKFY3HJP9QB2X8Q2X",
    "summary": "Document the invoice export endpoint",
    "details": null,
    "kind": "done",
    "status": null,
    "resolvedAt": null,
    "resolvedByEntryId": null,
    "project": "billing-api",
    "repo": "acme/billing-api",
    "branch": "fix/invoice-rounding",
    "source": "mcp",
    "agent": null,
    "tags": [
      "docs"
    ],
    "refs": []
  },
  "notes": []
}
```
