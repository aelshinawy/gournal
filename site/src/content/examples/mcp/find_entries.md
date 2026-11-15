Find done and next entries that match a word.

```json
{
  "text": "rounding",
  "kind": [
    "done",
    "next"
  ],
  "limit": 5
}
```

The text result:

```markdown
- 2026-11-15 16:04 `TXG3ZWS3` [billing-api] Add a regression test for tax rounding #testing #invoices (next, open)
- 2026-11-15 16:04 `YDZR73PK` [billing-api] Fix rounding error in invoice totals #bugfix #invoices
```

The structured result lists each entry with all of its fields. This example shows the first entry only.

```json
{
  "entries": [
    {
      "id": "01M7FRCQ9H56YJ9S1ATXG3ZWS3",
      "createdAt": "2026-11-15T14:04:47.281Z",
      "updatedAt": "2026-11-15T14:04:47.281Z",
      "deletedAt": null,
      "deviceId": "01M7FRCQ7JDAH7AYES8A121Y7N",
      "summary": "Add a regression test for tax rounding",
      "details": null,
      "kind": "next",
      "status": "open",
      "resolvedAt": null,
      "resolvedByEntryId": null,
      "project": "billing-api",
      "repo": "acme/billing-api",
      "branch": "fix/invoice-rounding",
      "source": "mcp",
      "agent": null,
      "tags": [
        "testing",
        "invoices"
      ],
      "refs": []
    },
    "... 1 more"
  ],
  "count": 2
}
```
