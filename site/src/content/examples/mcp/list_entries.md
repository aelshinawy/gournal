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
      "id": "01M7GHRBRPEGSY6KCPMJMM3EQM",
      "createdAt": "2026-11-15T21:28:03.094Z",
      "updatedAt": "2026-11-15T21:28:03.094Z",
      "deletedAt": null,
      "deviceId": "01M7GHRBRG66M23MA4RN24EN4V",
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
    },
    {
      "id": "01M7GHRBRP49F4XAA7Q56VS34E",
      "createdAt": "2026-11-15T21:28:03.094Z",
      "updatedAt": "2026-11-15T21:28:03.094Z",
      "deletedAt": null,
      "deviceId": "01M7GHRBRG66M23MA4RN24EN4V",
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
    }
  ],
  "count": 2
}
```
