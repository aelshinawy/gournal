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
- 2026-11-15 23:18 `27GTPX08` [billing-api] Add a regression test for tax rounding #review (next, open)
- 2026-11-15 23:18 `DA4FVKYK` [billing-api] Fix rounding error in invoice totals #review
```

The structured result lists each entry with all of its fields. This example shows the first entry only.

```json
{
  "entries": [
    {
      "id": "01M7GH6EZ45MKNZFFM27GTPX08",
      "createdAt": "2026-11-15T21:18:16.548Z",
      "updatedAt": "2026-11-15T21:18:16.548Z",
      "deletedAt": null,
      "deviceId": "01M7GH6EYY3YJAMZA5DHHG60SJ",
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
