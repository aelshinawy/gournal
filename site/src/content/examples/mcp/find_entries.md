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
- 2026-11-15 23:43 `48HE4S3P` [billing-api] Add a regression test for tax rounding #review (next, open)
- 2026-11-15 22:05 `757FDB8A` [billing-api] Fix rounding error in invoice totals #review
```

The structured result lists each entry with all of its fields. This example shows the first entry only.

```json
{
  "entries": [
    {
      "id": "01M7GJMZJHR4G9D9E848HE4S3P",
      "createdAt": "2026-11-15T21:43:40.881Z",
      "updatedAt": "2026-11-15T21:55:40.881Z",
      "deletedAt": null,
      "deviceId": "01M7GKAYPB65ZWS81V3FBKVF3W",
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
        "review"
      ],
      "refs": []
    },
    "... 1 more"
  ],
  "count": 2
}
```
