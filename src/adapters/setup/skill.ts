export const SKILL_MARKER = '<!-- managed by gournal setup; gournal setup claude --uninstall removes it -->';

export const SKILL_MD = `---
name: gournal
description: Log finished work to the gournal journal. Use after each distinct piece of work, when a blocker stops you, or when you plan a next step.
---
${SKILL_MARKER}

# Gournal

Gournal is the user's work journal. Log work with the \`add_entry\` MCP tool.

1. Log each distinct piece of finished work. Do not log a quick answer.
2. Always pass \`project\`. Pass \`cwd\` (your working directory), so that gournal records the repo and branch.
3. Write \`summary\` as one line of 120 characters or fewer. Put longer text in \`details\`.
4. Set \`kind\`: \`done\` (default) for finished work, \`blocker\` when something stops you, \`next\` for a planned next step.
5. To close an open blocker or next item, pass its id in \`resolves\` on the done entry, or call \`resolve_entry\`.
6. Put PR numbers, ticket keys, and commit SHAs in \`refs\`, not in \`tags\`. Reuse existing tags (\`list_tags\`).
7. For "what did I work on", call \`get_standup\` or \`get_work_log\`.
`;
