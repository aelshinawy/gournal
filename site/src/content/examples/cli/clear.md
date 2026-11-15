The command needs a terminal so that it can ask you to confirm. Without a terminal, it refuses and removes nothing. This example ran with the input redirected from `/dev/null`.

```console
$ gournal clear </dev/null
Not a terminal; nothing cleared.
```

The command exits with status 1.
