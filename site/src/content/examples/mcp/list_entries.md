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
      "id": "01M7GH1PYH5E1SZHJX7XYDNPAQ",
      "createdAt": "2026-11-15T21:15:40.881Z",
      "updatedAt": "2026-11-15T21:55:40.881Z",
      "deletedAt": null,
      "deviceId": "01M7GKAYPB65ZWS81V3FBKVF3W",
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
      "id": "01M7GG82MHZEA36MWTYHB4Y2E7",
      "createdAt": "2026-11-15T21:01:40.881Z",
      "updatedAt": "2026-11-15T21:55:40.881Z",
      "deletedAt": null,
      "deviceId": "01M7GKAYPB65ZWS81V3FBKVF3W",
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
