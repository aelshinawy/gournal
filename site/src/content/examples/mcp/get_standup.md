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
- 16:04 Fix rounding error in invoice totals

### Blockers
- `WESHEAS9` Cannot reproduce the failing webhook retry in staging (billing-api, since Nov 15)

### Next
- `TXG3ZWS3` Add a regression test for tax rounding (billing-api, since Nov 15)
```

The structured result holds the same data as JSON. This example shows the entries as `...` to stay short.

```json
{
  "title": "Today (2026-11-15)",
  "start": "2026-11-14T22:00:00.000Z",
  "end": "2026-11-15T14:04:47.282Z",
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
