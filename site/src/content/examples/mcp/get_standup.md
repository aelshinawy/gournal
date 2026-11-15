Get today's standup for one project.

```json
{
  "project": "billing-api"
}
```

The text result:

```markdown
## Standup: Today (2026-11-15)

### Done

**billing-api**
- 22:05 Fix rounding error in invoice totals
- 22:19 Add keyboard focus styles to the invoice date picker
- 22:33 Document the invoice export endpoint

### Blockers
- `ZY40X9DE` Cannot reproduce the failing webhook retry in staging (billing-api, since Nov 15)

### Next
- `48HE4S3P` Add a regression test for tax rounding (billing-api, since Nov 15)
```

The structured result holds the same data as JSON. This example shows the entries as `...` to stay short.

```json
{
  "title": "Today (2026-11-15)",
  "start": "2026-11-14T22:00:00.000Z",
  "end": "2026-11-15T21:55:47.440Z",
  "isMultiDay": false,
  "done": [
    {
      "project": "billing-api",
      "entries": [
        "..."
      ]
    }
  ],
  "blockers": [
    "..."
  ],
  "next": [
    "..."
  ],
  "stale": {
    "count": 0,
    "ids": [],
    "days": 14
  },
  "linkedActivity": {},
  "also": null,
  "syncWarning": null
}
```
