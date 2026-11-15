Resolve an open next item. Pass the short id.

```json
{
  "id": "27GTPX08"
}
```

The text result:

```text
Entry 27GTPX08 resolved: Add a regression test for tax rounding
```

The structured result:

```json
{
  "entry": {
    "id": "01M7GH6EZ45MKNZFFM27GTPX08",
    "createdAt": "2026-11-15T21:18:16.548Z",
    "updatedAt": "2026-11-15T21:21:00.345Z",
    "deletedAt": null,
    "deviceId": "01M7GH6EYY3YJAMZA5DHHG60SJ",
    "summary": "Add a regression test for tax rounding",
    "details": null,
    "kind": "next",
    "status": "resolved",
    "resolvedAt": "2026-11-15T21:21:00.345Z",
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
