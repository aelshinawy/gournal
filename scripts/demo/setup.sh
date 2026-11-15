# Sourced, hidden, at the start of each VHS tape. It never touches the real home.
# It makes a fresh temp home, fills it with the demo fixture, and aliases gournal to the built CLI.
unset HISTFILE
GOURNAL_REPO="$PWD"
T="$(mktemp -d)"
export GOURNAL_HOME="$T" HOME="$T" GOURNAL_NO_AUTOSYNC=1
node -r ts-node/register/transpile-only "$GOURNAL_REPO/scripts/demo/fixture.ts" "$T" > /dev/null || return 1
# A fake checkout of acme/api, so that gournal add records a realistic project, repo, and branch.
mkdir -p "$T/acme/api" && cd "$T/acme/api" || return 1
git init -q -b fix/token-refresh && git remote add origin https://github.com/acme/api.git
alias gournal="node $GOURNAL_REPO/dist/cli.js"
export PS1='\[\e[90m\]~/acme/api\[\e[0m\] $ '
clear
