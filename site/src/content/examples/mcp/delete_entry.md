Delete an entry. The entry stays in the database. The text result tells you the command that restores it.

```json
{
  "id": "MR0CE5K0"
}
```

The text result:

```text
Entry MR0CE5K0 removed: Document the invoice export endpoint
restore with gournal restore MR0CE5K0
```

The structured result has the same shape as the `add_entry` result. The `deletedAt` field holds the time of the deletion.

```json
{
  "entry": {
    "id": "01M7GH6EZ36EVX33KZMR0CE5K0",
    "createdAt": "2026-11-15T21:18:16.547Z",
    "updatedAt": "2026-11-15T21:21:00.144Z",
    "deletedAt": "2026-11-15T21:21:00.144Z",
    "deviceId": "01M7GH6EYY3YJAMZA5DHHG60SJ",
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
