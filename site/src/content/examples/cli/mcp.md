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

Claude Code registers the same server with one command.

```console
$ claude mcp add --scope user gournal -- gournal mcp
```
