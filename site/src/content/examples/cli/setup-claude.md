Set gournal up for Claude Code. This example ran with a fresh home folder that has no claude CLI. The command prints the step that you run yourself, and it writes the skill and the Stop hook.

```console
$ gournal setup claude --yes --hook
MCP server: register gournal for all projects (claude mcp add --scope user gournal -- gournal mcp).
MCP server: the claude CLI was not found. Run this command yourself:
  claude mcp add --scope user gournal -- gournal mcp
Skill: write /Users/you/.claude/skills/gournal/SKILL.md.
Skill: installed.
Stop hook: add "gournal hook stop" to /Users/you/.claude/settings.json.
Stop hook: added.
```

Run the command again. The skill step now reports that it is already set up.

```console
$ gournal setup claude --yes
MCP server: register gournal for all projects (claude mcp add --scope user gournal -- gournal mcp).
MCP server: the claude CLI was not found. Run this command yourself:
  claude mcp add --scope user gournal -- gournal mcp
Skill: already set up.
Stop hook: not enabled (add --hook to enable it).
```
