Log a finished piece of work. Pass `project` and `cwd`.

```json
{
  "summary": "Fix the stale totals in the invoice PDF",
  "details": "The PDF showed the total before the discount.",
  "project": "billing-api",
  "cwd": "/Users/you/dev/billing-api",
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
Entry AXG17ZBH added to billing-api: Fix the stale totals in the invoice PDF
```

The structured result:

```json
{
  "entry": {
    "id": "01M7GKB4XMS67T9RERAXG17ZBH",
    "createdAt": "2026-11-15T21:55:47.252Z",
    "updatedAt": "2026-11-15T21:55:47.252Z",
    "deletedAt": null,
    "deviceId": "01M7GKAYPB65ZWS81V3FBKVF3W",
    "summary": "Fix the stale totals in the invoice PDF",
    "details": "The PDF showed the total before the discount.",
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
