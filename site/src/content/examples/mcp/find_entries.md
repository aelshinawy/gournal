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
- 2026-11-15 23:28 `VN86G0RV` [billing-api] Add a regression test for tax rounding #review (next, open)
- 2026-11-15 23:28 `66CE7C23` [billing-api] Fix rounding error in invoice totals #review
```

The structured result lists each entry with all of its fields. This example shows the first entry only.

```json
{
  "entries": [
    {
      "id": "01M7GHRBRQWCBPVDN2VN86G0RV",
      "createdAt": "2026-11-15T21:28:03.095Z",
      "updatedAt": "2026-11-15T21:28:03.095Z",
      "deletedAt": null,
      "deviceId": "01M7GHRBRG66M23MA4RN24EN4V",
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
