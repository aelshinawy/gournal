List the two newest entries of one project. Pass a low `limit` so that the result stays short.

```json
{
  "project": "worker",
  "limit": 2
}
```

The structured result. The text result holds the `entries` list as JSON.

```json
{
  "entries": [
    {
      "id": "01M7GH6EZ4XNS2KMEFDZ1DB7ZW",
      "createdAt": "2026-11-15T21:18:16.548Z",
      "updatedAt": "2026-11-15T21:18:16.548Z",
      "deletedAt": null,
      "deviceId": "01M7GH6EYY3YJAMZA5DHHG60SJ",
      "summary": "Move the settings page to the new form components",
      "details": null,
      "kind": "done",
      "status": null,
      "resolvedAt": null,
      "resolvedByEntryId": null,
      "project": "worker",
      "repo": "acme/worker",
      "branch": "main",
      "source": "mcp",
      "agent": null,
      "tags": [
        "ui"
      ],
      "refs": []
    },
    {
      "id": "01M7GH6EZ4GPHFY8GC13T25F97",
      "createdAt": "2026-11-15T21:18:16.548Z",
      "updatedAt": "2026-11-15T21:18:16.548Z",
      "deletedAt": null,
      "deviceId": "01M7GH6EYY3YJAMZA5DHHG60SJ",
      "summary": "Document the retry policy for webhooks",
      "details": null,
      "kind": "done",
      "status": null,
      "resolvedAt": null,
      "resolvedByEntryId": null,
      "project": "worker",
      "repo": "acme/worker",
      "branch": "main",
      "source": "mcp",
      "agent": null,
      "tags": [
        "docs"
      ],
      "refs": []
    }
  ],
  "count": 2
}
```
