Resolve an open next item. Pass the short id.

```json
{
  "id": "RMGKJSHY"
}
```

The text result:

```text
Entry RMGKJSHY resolved: Add a regression test for tax rounding
```

The structured result:

```json
{
  "entry": {
    "id": "01M7GHKAQ0P2Q6EZZTRMGKJSHY",
    "createdAt": "2026-11-15T21:25:18.176Z",
    "updatedAt": "2026-11-15T21:25:24.026Z",
    "deletedAt": null,
    "deviceId": "01M7GHKAPQKFY3HJP9QB2X8Q2X",
    "summary": "Add a regression test for tax rounding",
    "details": null,
    "kind": "next",
    "status": "resolved",
    "resolvedAt": "2026-11-15T21:25:24.026Z",
    "resolvedByEntryId": null,
    "project": "billing-api",
    "repo": "acme/billing-api",
    "branch": "fix/invoice-rounding",
    "source": "mcp",
    "agent": null,
    "tags": [
      "review"
    ],
    "refs": []
  },
  "notes": []
}
```
