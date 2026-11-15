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
      "id": "01M7GHKAPZSBFKBP0YGBBC01PT",
      "createdAt": "2026-11-15T21:25:18.175Z",
      "updatedAt": "2026-11-15T21:25:18.175Z",
      "deletedAt": null,
      "deviceId": "01M7GHKAPQKFY3HJP9QB2X8Q2X",
      "summary": "Review the queue backoff change",
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
        "review",
        "ui"
      ],
      "refs": []
    },
    {
      "id": "01M7GHKAPZQ84ZVEEJXAHKXVH2",
      "createdAt": "2026-11-15T21:25:18.175Z",
      "updatedAt": "2026-11-15T21:25:18.175Z",
      "deletedAt": null,
      "deviceId": "01M7GHKAPQKFY3HJP9QB2X8Q2X",
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
