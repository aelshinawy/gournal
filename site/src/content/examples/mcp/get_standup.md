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
- 23:25 Fix rounding error in invoice totals
- 23:25 Add keyboard focus styles to the invoice date picker
- 23:25 Document the invoice export endpoint

### Blockers
- `G7Z7E298` Cannot reproduce the failing webhook retry in staging (billing-api, since Nov 15)

### Next
- `RMGKJSHY` Add a regression test for tax rounding (billing-api, since Nov 15)
```

The structured result holds the same data as JSON. This example shows the entries as `...` to stay short.

```json
{
  "title": "Today (2026-11-15)",
  "start": "2026-11-14T22:00:00.000Z",
  "end": "2026-11-15T21:25:23.854Z",
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
