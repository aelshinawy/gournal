Export the entries of one project as Markdown.

```console
$ gournal export -p billing-api
# Gournal Export

## billing-api

- `2026-11-15 23:25` Fix rounding error in invoice totals

Totals were off by one cent when a discount applied after tax. (#review)
- `2026-11-15 23:25` Add keyboard focus styles to the invoice date picker (#ui)
- `2026-11-15 23:25` Document the invoice export endpoint (#docs)
- `2026-11-15 23:25` Cannot reproduce the failing webhook retry in staging
- `2026-11-15 23:25` Add a regression test for tax rounding (#review)
```

Export entries that have a tag as CSV.

```console
$ gournal export -f csv -t ui
timestamp,project,message,tags,summary,details,kind,refs
2026-11-15T21:25:18.173Z,billing-api,Add keyboard focus styles to the invoice date picker,ui,Add keyboard focus styles to the invoice date picker,,done,
2026-11-15T21:25:18.174Z,worker,Move the settings page to the new form components,ui,Move the settings page to the new form components,,done,
2026-11-15T21:25:18.175Z,worker,Review the queue backoff change,review;ui,Review the queue backoff change,,done,
```
