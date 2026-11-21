Set gournal up for Claude Code. This example ran with a fresh home folder that has no claude CLI. The command prints the step that you run yourself, and it writes the skill and the Stop hook.

```console
$ gournal setup claude --yes --hook
MCP server: register gournal for all projects (claude mcp add --scope user gournal -- /Users/you/.gournal/bin/gournal mcp).
Launcher: installed in /Users/you/.gournal/runtime.
MCP server: the claude CLI was not found on PATH. Run this command yourself:
  claude mcp add --scope user gournal -- /Users/you/.gournal/bin/gournal mcp
Skill: write /Users/you/.claude/skills/gournal/SKILL.md.
Skill: installed.
Stop hook: add "/Users/you/.gournal/bin/gournal hook stop" to /Users/you/.claude/settings.json.
Stop hook: added.
Check: Claude Code can start gournal without your shell PATH.
```

Run the command again. The launcher, skill, and hook steps now report that they are already set up.

```console
$ gournal setup claude --yes
MCP server: register gournal for all projects (claude mcp add --scope user gournal -- /Users/you/.gournal/bin/gournal mcp).
Launcher: already set up.
MCP server: the claude CLI was not found on PATH. Run this command yourself:
  claude mcp add --scope user gournal -- /Users/you/.gournal/bin/gournal mcp
Skill: already set up.
Stop hook: already set up.
Check: Claude Code can start gournal without your shell PATH.
```
