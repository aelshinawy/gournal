An MCP client starts this command for you, so you do not run it in a terminal. The server speaks over stdin and stdout. It writes only MCP protocol messages to stdout. Notes go to stderr. Add it to the client configuration instead.

```json
{
  "mcpServers": {
    "gournal": {
      "command": "gournal",
      "args": ["mcp"]
    }
  }
}
```

For Claude Code, run `gournal setup claude`. A client that starts without your shell `PATH`, such as a desktop app, cannot find `gournal`. See [How Claude Code starts gournal](/docs/guides/claude-code-setup/#how-claude-code-starts-gournal).
