Log a finished piece of work. Pass `project` and `cwd`.

```json
{
  "summary": "Fix the retry loop in the sync worker",
  "project": "gournal",
  "cwd": "/Users/you/dev/gournal",
  "tags": ["bugfix"],
  "refs": [{ "type": "pr", "value": "42" }]
}
```

Close an open blocker with the `resolves` field.

```json
{
  "summary": "Unblock the release build",
  "project": "gournal",
  "resolves": ["3f9a1c2e"]
}
```
