Fix the summary of an entry, replace its tags, and add a pull request reference. Fields that you omit stay as they are.

```json
{
  "id": "D12ZERTC",
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
Entry D12ZERTC updated: Document the invoice export endpoint and its limits
```

The structured result:

```json
{
  "entry": {
    "id": "01M7GEMT0G42PWG95KD12ZERTC",
    "createdAt": "2026-11-15T20:33:40.880Z",
    "updatedAt": "2026-11-15T21:55:47.781Z",
    "deletedAt": null,
    "deviceId": "01M7GKAYPB65ZWS81V3FBKVF3W",
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
