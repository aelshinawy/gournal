Show the totals, your streak, and the entries for each project and tag.

```console
$ gournal stats

Stats

  Total entries: 8
  Current streak: 1 day

  By project
    billing-api: 5
    worker: 3

  By tag
    #review: 3
    #ui: 3
    #docs: 2
```

Limit the numbers to one project.

```console
$ gournal stats -p worker

Stats

  Total entries: 3
  Current streak: 1 day

  By project
    worker: 3

  By tag
    #ui: 2
    #docs: 1
    #review: 1
```
