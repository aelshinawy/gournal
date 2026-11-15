Delete an entry. The entry stays in the database. The text result tells you the command that restores it.

```json
{
  "id": "D12ZERTC"
}
```

The text result:

```text
Entry D12ZERTC removed: Document the invoice export endpoint
restore with gournal restore D12ZERTC
```

The structured result has the same shape as the `add_entry` result. The `deletedAt` field holds the time of the deletion.

```json
{
  "entry": {
    "id": "01M7GEMT0G42PWG95KD12ZERTC",
    "createdAt": "2026-11-15T20:33:40.880Z",
    "updatedAt": "2026-11-15T21:55:47.422Z",
    "deletedAt": "2026-11-15T21:55:47.422Z",
    "deviceId": "01M7GKAYPB65ZWS81V3FBKVF3W",
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
