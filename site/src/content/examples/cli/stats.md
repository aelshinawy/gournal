Show the totals, your streak, and the entries for each project and tag.

```console
$ gournal stats

Stats

  Total entries: 5
  Current streak: 1 day

  By project
    billing-api: 3
    web-app: 2

  By tag
    #invoices: 2
    #ui: 2
    #a11y: 1
    #bugfix: 1
    #testing: 1
    #webhooks: 1
```

Limit the numbers to one project.

```console
$ gournal stats -p web-app

Stats

  Total entries: 2
  Current streak: 1 day

  By project
    web-app: 2

  By tag
    #ui: 2
    #a11y: 1
```
