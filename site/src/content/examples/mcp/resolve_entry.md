Resolve an open next item. Pass the short id.

```json
{
  "id": "48HE4S3P"
}
```

The text result:

```text
Entry 48HE4S3P resolved: Add a regression test for tax rounding
```

The structured result:

```json
{
  "entry": {
    "id": "01M7GJMZJHR4G9D9E848HE4S3P",
    "createdAt": "2026-11-15T21:43:40.881Z",
    "updatedAt": "2026-11-15T21:55:47.622Z",
    "deletedAt": null,
    "deviceId": "01M7GKAYPB65ZWS81V3FBKVF3W",
    "summary": "Add a regression test for tax rounding",
    "details": null,
    "kind": "next",
    "status": "resolved",
    "resolvedAt": "2026-11-15T21:55:47.622Z",
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
