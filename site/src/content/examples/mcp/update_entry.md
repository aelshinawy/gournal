Fix the summary of an entry, replace its tags, and add a pull request reference. Fields that you omit stay as they are. The `details` text below stays the same.

```json
{
  "id": "DA4FVKYK",
  "summary": "Fix one-cent rounding error in invoice totals",
  "tags": [
    "review",
    "docs"
  ],
  "refs": [
    {
      "type": "pr",
      "value": "412",
      "repo": "acme/billing-api"
    }
  ]
}
```

The text result:

```text
Entry DA4FVKYK updated: Fix one-cent rounding error in invoice totals
```

The structured result:

```json
{
  "entry": {
    "id": "01M7GH6EZ2E6SQ8017DA4FVKYK",
    "createdAt": "2026-11-15T21:18:16.546Z",
    "updatedAt": "2026-11-15T21:21:00.510Z",
    "deletedAt": null,
    "deviceId": "01M7GH6EYY3YJAMZA5DHHG60SJ",
    "summary": "Fix one-cent rounding error in invoice totals",
    "details": "Totals were off by one cent when a discount applied after tax.",
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
      "review",
      "docs"
    ],
    "refs": [
      {
        "type": "pr",
        "value": "412",
        "repo": "acme/billing-api"
      }
    ]
  },
  "notes": []
}
```
