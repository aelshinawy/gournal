#!/bin/sh
# Homebrew smoke test.
# This script packs gournal, installs the tarball through a local Homebrew tap, and runs
# "gournal setup claude" from the Homebrew install against a fake claude with a minimal PATH.
# It checks that the launcher records the stable opt paths and that Claude Code can start it.
#
# Usage: GOURNAL_ALLOW_BREW=1 sh scripts/homebrew-smoke.sh
#
# The script installs a formula into the brew of this machine. It refuses to run unless
# GITHUB_ACTIONS=true or GOURNAL_ALLOW_BREW=1. It sets HOME to a temporary folder, refuses the real
# home and the real ~/.gournal, and removes the formula, the tap, and the folder on exit.
# It does not set GOURNAL_HOME, so the default home is used inside the temporary folder.

set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"

if [ "${GITHUB_ACTIONS:-}" != "true" ] && [ "${GOURNAL_ALLOW_BREW:-}" != "1" ]; then
  echo "homebrew-smoke: this script installs a formula into your Homebrew." >&2
  echo "homebrew-smoke: set GOURNAL_ALLOW_BREW=1 to run it, or run it in GitHub Actions." >&2
  exit 2
fi
command -v brew >/dev/null 2>&1 || { echo "homebrew-smoke: FAIL: brew is not on PATH" >&2; exit 1; }
# A real gournal formula must stay. Only a GitHub Actions runner may have one removed.
if [ "${GITHUB_ACTIONS:-}" != "true" ]; then
  if brew list --formula gournal >/dev/null 2>&1; then
    echo "homebrew-smoke: gournal is installed in this Homebrew. Uninstall it first. The script will not touch it." >&2
    exit 2
  fi
  echo "homebrew-smoke: this run installs node and a test tap formula into the real Homebrew prefix $(brew --prefix)." >&2
fi

real_home=$HOME
# Keep the npm cache of the user. HOME changes below, and the cache would move with it.
npm_cache=$(npm config get cache)
# Read the brew prefix before HOME changes.
prefix=$(brew --prefix)
ci_node=$(node -p "process.execPath")
ci_node_dir=$(dirname "$ci_node")

export HOMEBREW_NO_AUTO_UPDATE=1
export HOMEBREW_NO_ANALYTICS=1
export HOMEBREW_NO_ENV_HINTS=1

tap=local/gournal-test
tap_made=0
installed=0
tmp=$(mktemp -d "${TMPDIR:-/tmp}/gournal-brew-smoke.XXXXXX")

cleanup() {
  cd "$root" 2>/dev/null || cd / || true
  # Remove only the formula of this run. A scenario can have removed it already.
  if [ "$installed" -eq 1 ]; then brew uninstall --formula "$tap/gournal" >/dev/null 2>&1 || true; fi
  if [ "$tap_made" -eq 1 ]; then brew untap "$tap" >/dev/null 2>&1 || true; fi
  rm -rf "$tmp" || true
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

fail() {
  echo "homebrew-smoke: FAIL: $*" >&2
  exit 1
}

canon_tmp=$(cd -P "$tmp" && pwd -P)
canon_home=$(cd -P "$real_home" && pwd -P)
[ "$canon_tmp" != "$canon_home" ] || fail "the temporary folder is the real home"
case "$canon_tmp" in
  "$canon_home/.gournal" | "$canon_home/.gournal/"*) fail "the temporary folder is inside the real ~/.gournal" ;;
esac

mkdir "$tmp/pack" "$tmp/home" "$tmp/work" "$tmp/fakebin"
export npm_config_cache="$npm_cache"
export HOME="$tmp/home"
export GOURNAL_NO_AUTOSYNC=1
unset GOURNAL_HOME

expected=$(node -p "require('./package.json').version")
echo "homebrew-smoke: build and pack"
npm run --silent clean
npm run --silent build
tarball=$(npm pack --silent --pack-destination "$tmp/pack" | tail -n 1)
[ -f "$tmp/pack/$tarball" ] || fail "npm pack did not create $tarball"
if command -v sha256sum >/dev/null 2>&1; then
  sha=$(sha256sum "$tmp/pack/$tarball" | cut -d ' ' -f 1)
else
  sha=$(shasum -a 256 "$tmp/pack/$tarball" | cut -d ' ' -f 1)
fi

echo "homebrew-smoke: make the local tap $tap"
brew untap "$tap" >/dev/null 2>&1 || true
brew tap-new --no-git "$tap" >/dev/null
tap_made=1
formula_dir="$(brew --repository "$tap")/Formula"
mkdir -p "$formula_dir"
sed -e "s|^  url \".*\"|  url \"file://$tmp/pack/$tarball\"|" \
    -e "s|^  sha256 \".*\"|  sha256 \"$sha\"|" \
    packaging/homebrew/gournal.rb >"$formula_dir/gournal.rb"
grep -q -F "file://$tmp/pack/$tarball" "$formula_dir/gournal.rb" || fail "the formula url was not replaced"

echo "homebrew-smoke: brew install"
installed=1
brew install --formula "$tap/gournal"
echo "homebrew-smoke: brew test"
brew test "$tap/gournal"

# Premise P9: the layout of the install. Premise P10: the shebang of the entry file.
brew_cli="$prefix/opt/gournal/libexec/lib/node_modules/gournal/dist/cli.js"
brew_bin="$prefix/opt/gournal/bin/gournal"
echo "homebrew-smoke: P9 layout"
ls -l "$prefix/opt/gournal/libexec/bin" "$brew_cli" "$brew_bin" || fail "P9: the Homebrew layout is not what the formula expects"
echo "homebrew-smoke: P10 shebang"
shebang=$(head -n 1 "$brew_cli")
echo "$shebang"
[ "$shebang" = "#!$prefix/opt/node/bin/node" ] || fail "P10: the shebang is '$shebang', expected '#!$prefix/opt/node/bin/node'"

# The fake claude keeps ~/.claude.json in step like the real one for add and remove.
# It logs its arguments. The first line uses the Node.js of this job, by absolute path.
calls="$tmp/claude-calls.log"
: >"$calls"
cat >"$tmp/fakebin/claude" <<EOF
#!$ci_node
const fs = require('fs');
const path = require('path');
const argv = process.argv.slice(2);
fs.appendFileSync('$calls', argv.join(' ') + '\n');
const file = path.join(process.env.HOME, '.claude.json');
let data = {};
try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { data = {}; }
data.mcpServers = data.mcpServers || {};
if (argv[0] === 'mcp' && argv[1] === 'add') {
  const name = argv[argv.indexOf('--scope') + 2];
  if (data.mcpServers[name]) {
    process.stderr.write('MCP server ' + name + ' already exists in user config\\n');
    process.exit(1);
  }
  const rest = argv.slice(argv.indexOf('--') + 1);
  data.mcpServers[name] = { type: 'stdio', command: rest[0], args: rest.slice(1) };
} else if (argv[0] === 'mcp' && argv[1] === 'remove') {
  delete data.mcpServers[argv[argv.length - 1]];
}
fs.writeFileSync(file, JSON.stringify(data));
EOF
chmod +x "$tmp/fakebin/claude"

settings="$HOME/.claude/settings.json"
launcher=$(printf '%s' "$HOME/.gournal/bin/gournal" | sed 's|//*|/|g')
brew_node="$prefix/opt/node/bin/node"
min_path="/usr/bin:/bin"
extra_path=""

# Run a gournal binary with the fake claude first on PATH. The input is /dev/null.
run_setup() {
  gbin=$1
  shift
  (
    cd "$tmp/work"
    PATH="$tmp/fakebin:$extra_path:$min_path" "$gbin" setup claude "$@"
  ) </dev/null >"$tmp/setup.out" 2>&1
}

# Print a count. The first argument is reg or hook. The second is the file to read.
count() {
  node -e '
const fs = require("fs");
const read = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return {}; } };
if (process.argv[1] === "reg") {
  const s = (read(process.argv[2]).mcpServers) || {};
  console.log(Object.keys(s).filter((k) => k === "gournal").length);
} else {
  const stop = ((read(process.argv[2]).hooks) || {}).Stop || [];
  console.log(JSON.stringify(stop).split("hook stop").length - 1);
}
' "$1" "$2"
}

runtime_node() {
  tr -d '\n' <"$HOME/.gournal/runtime/node"
}

echo "homebrew-smoke: scenario 1, setup with a minimal PATH"
extra_path="$prefix/bin"
status=0
run_setup "$brew_bin" --yes --hook || status=$?
cat "$tmp/setup.out"
[ "$status" -eq 0 ] || fail "scenario 1: setup exited with status $status"
grep -q -F "Homebrew: the launcher runs gournal from $prefix/opt/gournal with $brew_node." "$tmp/setup.out" || fail "scenario 1: the Homebrew line is missing"
grep -q -F "Check: Claude Code can start gournal without your shell PATH." "$tmp/setup.out" || fail "scenario 1: the check pass line is missing"
node -e '
const fs = require("fs");
const s = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).mcpServers.gournal;
const want = process.argv[2];
if (s.command !== want || JSON.stringify(s.args) !== JSON.stringify(["mcp"])) {
  console.error("registered: " + JSON.stringify(s) + ", expected " + want + " mcp");
  process.exit(1);
}
' "$HOME/.claude.json" "$launcher" || fail "scenario 1: the registered words are not the launcher and mcp"
[ "$(runtime_node)" = "$brew_node" ] || fail "scenario 1: runtime/node holds '$(runtime_node)', expected '$brew_node'"

echo "homebrew-smoke: scenario 2, GUI style launch"
gui() { env -i HOME="$HOME" PATH="$min_path" "$@"; }
actual=$(gui "$launcher" --version)
echo "$actual"
[ "$actual" = "$expected" ] || fail "scenario 2: version is '$actual', expected '$expected'"
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"homebrew-smoke","version":"0.0.0"}}}' >"$tmp/mcp.in"
# Start the server directly. A watchdog stops the wait when the server does not exit.
gui "$launcher" mcp <"$tmp/mcp.in" >"$tmp/mcp.out" 2>"$tmp/mcp.err" &
mcp_pid=$!
waited=0
while kill -0 "$mcp_pid" 2>/dev/null; do
  if [ "$waited" -ge 20 ]; then
    kill "$mcp_pid" 2>/dev/null || true
    fail "scenario 2: gournal mcp did not exit within 20 seconds after standard input closed"
  fi
  sleep 1
  waited=$((waited + 1))
done
mcp_status=0
wait "$mcp_pid" || mcp_status=$?
[ "$mcp_status" -eq 0 ] || fail "scenario 2: mcp exited with status $mcp_status: $(cat "$tmp/mcp.err")"
cat "$tmp/mcp.out"
grep -q '"result"' "$tmp/mcp.out" || fail "scenario 2: the initialize response has no result"
grep -q '"name":"gournal"' "$tmp/mcp.out" || fail "scenario 2: the initialize response does not name gournal"
hook_cmd=$(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(s.hooks.Stop[0].hooks[0].command)' "$settings")
echo "$hook_cmd"
hook_status=0
printf '{}' | gui /bin/sh -c "$hook_cmd" >"$tmp/hook.out" 2>&1 || hook_status=$?
cat "$tmp/hook.out"
[ "$hook_status" -eq 0 ] || fail "scenario 2: the hook exited with status $hook_status"

echo "homebrew-smoke: scenario 3, npm to Homebrew to npm"
mkdir "$tmp/npm"
npm install --global --prefix "$tmp/npm" --no-audit --no-fund --loglevel=error "$tmp/pack/$tarball"
npm_bin="$tmp/npm/bin/gournal"
[ -x "$npm_bin" ] || fail "scenario 3: the npm install has no $npm_bin"
step() {
  label=$1
  gbin=$2
  want_node=$3
  extra_path=$4
  want_source=$5
  status=0
  adds_before=$(grep -c '^mcp add ' "$calls" || true)
  run_setup "$gbin" --yes --hook || status=$?
  cat "$tmp/setup.out"
  [ "$status" -eq 0 ] || fail "scenario 3 ($label): setup exited with status $status"
  adds=$(( $(grep -c '^mcp add ' "$calls" || true) - adds_before ))
  [ "$adds" -le 1 ] || fail "scenario 3 ($label): setup ran 'claude mcp add' $adds times"
  [ "$(count reg "$HOME/.claude.json")" = "1" ] || fail "scenario 3 ($label): the registration count is not 1"
  [ "$(count hook "$settings")" = "1" ] || fail "scenario 3 ($label): the hook count is not 1"
  [ "$(runtime_node)" = "$want_node" ] || fail "scenario 3 ($label): runtime/node holds '$(runtime_node)', expected '$want_node'"
  # F1: runtime/source follows the channel that ran last.
  [ "$(tr -d '\n' <"$HOME/.gournal/runtime/source")" = "$want_source" ] || fail "scenario 3 ($label): runtime/source holds '$(tr -d '\n' <"$HOME/.gournal/runtime/source")', expected '$want_source'"
}
npm_source=$(cd -P "$tmp/npm/lib/node_modules/gournal" && pwd -P)
brew_source="$prefix/opt/gournal/libexec/lib/node_modules/gournal"
step "npm first" "$npm_bin" "$ci_node" "$ci_node_dir" "$npm_source"
step "homebrew" "$brew_bin" "$brew_node" "$prefix/bin" "$brew_source"
step "npm again" "$npm_bin" "$ci_node" "$ci_node_dir" "$npm_source"
# Leave the Homebrew channel last, as a user would for the uninstall scenario.
step "homebrew again" "$brew_bin" "$brew_node" "$prefix/bin" "$brew_source"

echo "homebrew-smoke: scenario 4, uninstall"
extra_path="$prefix/bin"
status=0
run_setup "$brew_bin" --uninstall --yes || status=$?
cat "$tmp/setup.out"
[ "$status" -eq 0 ] || fail "scenario 4: uninstall exited with status $status"
[ "$(count hook "$settings")" = "0" ] || fail "scenario 4: a gournal hook is left in settings.json"
[ "$(count reg "$HOME/.claude.json")" = "0" ] || fail "scenario 4: the registration is left"
[ -f "$brew_cli" ] || fail "scenario 4: the Cellar files are gone"

# Scenarios 5 and 6 start the launcher the way Claude Code does: no shell PATH. The fake claude is
# on the PATH only for the run that has to call it.
silent_hook() {
  hook_status=0
  printf '{}' | env -i HOME="$HOME" PATH="$1" /bin/sh -c "$hook_cmd" >"$tmp/hook.out" 2>&1 || hook_status=$?
  [ "$hook_status" -eq 0 ] || fail "the hook exited with status $hook_status: $(cat "$tmp/hook.out")"
  [ ! -s "$tmp/hook.out" ] || fail "the hook printed: $(cat "$tmp/hook.out")"
}
removed_at="$HOME/.gournal/runtime/removed-at"

echo "homebrew-smoke: scenario 5, brew uninstall without --uninstall"
# After brew uninstall autoremoves Homebrew node, a broken image node@NN can be the only node left.
# The CI node on PATH gives scenarios 5 and 6 a known good node.
post_path="$ci_node_dir:$min_path"
gui() { env -i HOME="$HOME" PATH="$post_path" "$@"; }
extra_path="$prefix/bin"
status=0
run_setup "$brew_bin" --yes --hook || status=$?
cat "$tmp/setup.out"
[ "$status" -eq 0 ] || fail "scenario 5: setup exited with status $status"
gui env GOURNAL_NO_AUTOSYNC=1 "$launcher" add "brew smoke" >/dev/null || fail "scenario 5: add through the launcher failed"
[ -f "$HOME/.gournal/gournal.db" ] || fail "scenario 5: add did not create gournal.db"
hook_cmd=$(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(s.hooks.Stop[0].hooks[0].command)' "$settings")
brew uninstall --formula "$tap/gournal"
installed=0
[ ! -e "$brew_cli" ] || fail "scenario 5: brew uninstall left $brew_cli"
silent_hook "$post_path"
[ -f "$removed_at" ] || fail "scenario 5: the first hook after the uninstall did not write removed-at"
actual=$(gui "$launcher" --version 2>"$tmp/grace.err")
[ "$actual" = "$expected" ] || fail "scenario 5: version in the grace window is '$actual', expected '$expected'"
[ "$(wc -l <"$tmp/grace.err" | tr -d ' ')" -eq 1 ] || fail "scenario 5: stderr in the grace window is not one line: $(cat "$tmp/grace.err")"
grep -q 'is missing. gournal runs from its copy in' "$tmp/grace.err" || fail "scenario 5: the notice line is wrong: $(cat "$tmp/grace.err")"
settings_before=$(cksum <"$settings")
echo $(( $(date +%s) - 61 )) >"$removed_at"
mcp_status=0
gui "$launcher" mcp </dev/null >"$tmp/gone.out" 2>"$tmp/gone.err" || mcp_status=$?
[ "$mcp_status" -eq 1 ] || fail "scenario 5: mcp after the grace window exited with $mcp_status, expected 1"
[ ! -s "$tmp/gone.out" ] || fail "scenario 5: mcp wrote to stdout: $(cat "$tmp/gone.out")"
[ "$(wc -l <"$tmp/gone.err" | tr -d ' ')" -eq 1 ] || fail "scenario 5: stderr after the grace window is not one line: $(cat "$tmp/gone.err")"
grep -q 'setup claude --uninstall' "$tmp/gone.err" || fail "scenario 5: the no-longer-installed line is wrong: $(cat "$tmp/gone.err")"
silent_hook "$post_path"
[ "$(cksum <"$settings")" = "$settings_before" ] || fail "scenario 5: the hook changed settings.json before the cleanup time"
[ -d "$HOME/.gournal/runtime" ] || fail "scenario 5: the hook removed the runtime before the cleanup time"
echo $(( $(date +%s) - 3600 )) >"$removed_at"
silent_hook "$tmp/fakebin:$post_path"
[ "$(count hook "$settings")" = "0" ] || fail "scenario 5: the cleanup left the gournal hook"
[ "$(count reg "$HOME/.claude.json")" = "0" ] || fail "scenario 5: the cleanup left the registration"
grep -q '^mcp remove ' "$calls" || fail "scenario 5: the cleanup did not run claude mcp remove"
[ ! -e "$HOME/.claude/skills/gournal/SKILL.md" ] || fail "scenario 5: the cleanup left the skill file"
[ ! -e "$launcher" ] || fail "scenario 5: the cleanup left the launcher"
[ ! -e "$HOME/.gournal/runtime" ] || fail "scenario 5: the cleanup left the runtime folder"
[ -f "$HOME/.gournal/gournal.db" ] || fail "scenario 5: the cleanup removed the journal file"

echo "homebrew-smoke: scenario 6, premise P17 (the rack stays during brew upgrade)"
# Two versions of the packed tarball: a temp copy of the package with two version values.
p17="$tmp/p17"
mkdir "$p17"
for v in 0.0.1 0.0.2; do
  mkdir "$p17/src-$v"
  cp -R dist "$p17/src-$v/dist"
  node -e 'const p = require("./package.json"); p.version = process.argv[1]; require("fs").writeFileSync(process.argv[2], JSON.stringify(p, null, 2));' "$v" "$p17/src-$v/package.json"
  (cd "$p17/src-$v" && npm pack --silent --pack-destination "$p17" >/dev/null)
done
formula_for() {
  sum=$(shasum -a 256 "$p17/gournal-$1.tgz" | cut -d ' ' -f 1)
  sed -e "s|^  url \".*\"|  url \"file://$p17/gournal-$1.tgz\"|" \
      -e "s|^  sha256 \".*\"|  sha256 \"$sum\"|" \
      packaging/homebrew/gournal.rb >"$formula_dir/gournal.rb"
}
formula_for 0.0.1
installed=1
brew install --formula "$tap/gournal"
extra_path="$prefix/bin"
status=0
run_setup "$brew_bin" --yes --hook || status=$?
cat "$tmp/setup.out"
[ "$status" -eq 0 ] || fail "scenario 6: setup exited with status $status"
hook_cmd=$(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(s.hooks.Stop[0].hooks[0].command)' "$settings")
: >"$p17/loop.log"
(
  while [ ! -f "$p17/stop" ]; do
    [ -d "$prefix/Cellar/gournal" ] || echo RACK-GONE >>"$p17/loop.log"
    sleep 0.01
  done
) &
loop_pid=$!
formula_for 0.0.2
upgrade_status=0
brew upgrade --formula "$tap/gournal" || upgrade_status=$?
: >"$p17/stop"
wait "$loop_pid" || true
[ "$upgrade_status" -eq 0 ] || fail "scenario 6: brew upgrade exited with status $upgrade_status"
[ ! -s "$p17/loop.log" ] || fail "P17: the rack folder $prefix/Cellar/gournal was gone during brew upgrade: $(wc -l <"$p17/loop.log" | tr -d ' ') samples"
silent_hook "$post_path"
[ ! -e "$removed_at" ] || fail "scenario 6: removed-at exists after brew upgrade"
actual=$(gui "$launcher" --version 2>"$tmp/upgrade.err")
[ -z "$(cat "$tmp/upgrade.err")" ] || fail "scenario 6: stderr after brew upgrade: $(cat "$tmp/upgrade.err")"
echo "$actual"

echo "homebrew-smoke: OK (gournal $expected)"
