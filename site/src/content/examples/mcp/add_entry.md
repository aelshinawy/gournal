Log a finished piece of work. Pass `project` and `cwd`.

```json
{
  "summary": "Fix rounding error in invoice totals",
  "details": "Totals were off by one cent when a discount applied after tax.",
  "project": "billing-api",
  "cwd": "/Users/you/dev/billing-api",
  "tags": [
    "bugfix",
    "invoices"
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
Entry YDZR73PK added to billing-api: Fix rounding error in invoice totals
```

The structured result:

```json
{
  "entry": {
    "id": "01M7FRCQ8GYQH7Z6X9YDZR73PK",
    "createdAt": "2026-11-15T14:04:47.248Z",
    "updatedAt": "2026-11-15T14:04:47.248Z",
    "deletedAt": null,
    "deviceId": "01M7FRCQ7JDAH7AYES8A121Y7N",
    "summary": "Fix rounding error in invoice totals",
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
      "bugfix",
      "invoices"
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
