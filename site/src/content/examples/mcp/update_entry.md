Fix the summary of an entry, replace its tags, and add a pull request reference. Fields that you omit stay as they are.

```json
{
  "id": "HSWY5QWK",
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
Entry HSWY5QWK updated: Document the invoice export endpoint and its limits
```

The structured result:

```json
{
  "entry": {
    "id": "01M7GHRBRPCWFZY93MHSWY5QWK",
    "createdAt": "2026-11-15T21:28:03.094Z",
    "updatedAt": "2026-11-15T21:28:09.129Z",
    "deletedAt": null,
    "deviceId": "01M7GHRBRG66M23MA4RN24EN4V",
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
