Fix the summary of an entry, replace its tags, and add a pull request reference. Fields that you omit stay as they are. The `details` text below stays the same.

```json
{
  "id": "BREW8H23",
  "summary": "Document the invoice export endpoint and its limits",
  "tags": [
    "docs",
    "review"
  ],
  "refs": [
    {
      "type": "pr",
      "value": "415",
      "repo": "acme/billing-api"
    }
  ]
}
```

The text result:

```text
Entry BREW8H23 updated: Document the invoice export endpoint and its limits
```

The structured result:

```json
{
  "entry": {
    "id": "01M7GHKAPYGCB9VB4GBREW8H23",
    "createdAt": "2026-11-15T21:25:18.174Z",
    "updatedAt": "2026-11-15T21:25:24.196Z",
    "deletedAt": null,
    "deviceId": "01M7GHKAPQKFY3HJP9QB2X8Q2X",
    "summary": "Document the invoice export endpoint and its limits",
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
      "docs",
      "review"
    ],
    "refs": [
      {
        "type": "pr",
        "value": "415",
        "repo": "acme/billing-api"
      }
    ]
  },
  "notes": []
}
```
