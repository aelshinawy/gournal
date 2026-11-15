Export the entries of one project as Markdown.

```console
$ gournal export -p billing-api
# Gournal Export

## billing-api

- `2026-11-15 16:04` Fix rounding error in invoice totals

Totals were off by one cent when a discount applied after tax. (#bugfix #invoices)
- `2026-11-15 16:04` Cannot reproduce the failing webhook retry in staging (#webhooks)
- `2026-11-15 16:04` Add a regression test for tax rounding (#testing #invoices)
```

Export entries that have a tag as CSV.

```console
$ gournal export -f csv -t ui
timestamp,project,message,tags,summary,details,kind,refs
2026-11-15T14:04:24.361Z,web-app,Move the settings page to the new form components,ui,Move the settings page to the new form components,,done,
2026-11-15T14:04:24.550Z,web-app,Add keyboard focus styles to the date picker,ui;a11y,Add keyboard focus styles to the date picker,,done,
```
