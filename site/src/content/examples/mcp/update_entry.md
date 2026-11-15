Fix the summary of an entry, replace its tags, and add a pull request reference. Fields that you omit stay as they are. The `details` text below stays the same.

```json
{
  "id": "E8NCXFNC",
  "summary": "Fix one-cent rounding error in invoice totals",
  "tags": [
    "bugfix",
    "invoices",
    "billing"
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
Entry E8NCXFNC updated: Fix one-cent rounding error in invoice totals
```

The structured result:

```json
{
  "entry": {
    "id": "01M7G81PBKX4K9HC1XE8NCXFNC",
    "createdAt": "2026-11-15T18:38:23.091Z",
    "updatedAt": "2026-11-15T18:39:12.022Z",
    "deletedAt": null,
    "deviceId": "01M7G81PASZ2E8T209BWDT235N",
    "summary": "Fix one-cent rounding error in invoice totals",
    "details": "Totals were off by one cent when a discount applied after tax.",
    "kind": "done",
    "status": null,
    "resolvedAt": null,
    "resolvedByEntryId": null,
    "project": "billing-api",
    "repo": null,
    "branch": "main",
    "source": "cli",
    "agent": null,
    "tags": [
      "bugfix",
      "invoices",
      "billing"
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
