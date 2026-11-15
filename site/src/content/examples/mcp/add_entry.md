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
Entry 75STEM6Q added to billing-api: Fix the stale totals in the invoice PDF
```

The structured result:

```json
{
  "entry": {
    "id": "01M7GHRH51FPHH309F75STEM6Q",
    "createdAt": "2026-11-15T21:28:08.609Z",
    "updatedAt": "2026-11-15T21:28:08.609Z",
    "deletedAt": null,
    "deviceId": "01M7GHRBRG66M23MA4RN24EN4V",
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
