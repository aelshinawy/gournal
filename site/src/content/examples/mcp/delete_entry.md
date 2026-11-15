Delete an entry. The entry stays in the database. The text result tells you the command that restores it.

```json
{
  "id": "HSWY5QWK"
}
```

The text result:

```text
Entry HSWY5QWK removed: Document the invoice export endpoint
restore with gournal restore HSWY5QWK
```

The structured result has the same shape as the `add_entry` result. The `deletedAt` field holds the time of the deletion.

```json
{
  "entry": {
    "id": "01M7GHRBRPCWFZY93MHSWY5QWK",
    "createdAt": "2026-11-15T21:28:03.094Z",
    "updatedAt": "2026-11-15T21:28:08.774Z",
    "deletedAt": "2026-11-15T21:28:08.774Z",
    "deviceId": "01M7GHRBRG66M23MA4RN24EN4V",
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
