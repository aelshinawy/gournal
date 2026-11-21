#!/bin/sh
# Launcher smoke test.
# This script replays the Node version manager repro. It installs the packed gournal into one
# fake nvm Node version and runs "gournal setup claude". Then it starts the registered command
# the way Claude Code does (no shell, a minimal environment) and checks these cases:
#   - the minimal PATH
#   - a switch of the default Node version
#   - the removal of the Node version that setup used
#   - a Node older than 22.13 (needs GOURNAL_OLD_NODE, the path of a Node 22.12.0 binary)
#   - the removal of the package without "setup claude --uninstall"
#
# Usage: sh scripts/launcher-smoke.sh
# GOURNAL_TARBALL names a packed tarball. Without it, the script builds and packs one.
# The script uses a temporary HOME. See smoke-lib.sh.

set -eu

. "$(dirname "$0")/smoke-lib.sh"
smoke_init launcher-smoke
smoke_pack
ci_node=$(node -p "process.execPath")

# Two copies of the CI Node, as a version manager keeps them. Node reports the real path as
# execPath, so a symlink would record the CI Node.
if [ "$windows" -eq 1 ]; then
  nodes="$LOCALAPPDATA/nvm"
  va_bin="$nodes/vA"
  vb_bin="$nodes/vB"
  node_name="node.exe"
  cli_rel="node_modules/gournal/dist/cli.js"
else
  nodes="$HOME/.nvm/versions/node"
  va_bin="$nodes/vA/bin"
  vb_bin="$nodes/vB/bin"
  node_name="node"
  cli_rel="lib/node_modules/gournal/dist/cli.js"
fi
va="$nodes/vA"
vb="$nodes/vB"
cli="$va/$cli_rel"
mkdir -p "$va_bin" "$vb_bin"
for d in "$va_bin" "$vb_bin"; do
  cp "$ci_node" "$d/$node_name"
  chmod +x "$d/$node_name"
done

calls="$tmp/claude-calls.log"
write_fake_claude "$calls" "$tmp/fakebin"
if [ "$windows" -eq 1 ]; then
  sys_path=$(cygpath -u "$SYSTEMROOT")/System32
  # The child of the helper is a native program. It needs native folders joined with a semicolon.
  child_vb=$(cygpath -w "$vb_bin")
  child_sys="$SYSTEMROOT\\System32"
  sep=";"
else
  sys_path=/usr/bin:/bin
  child_vb="$vb_bin"
  child_sys="$sys_path"
  sep=":"
fi

# launch.js starts a command the way Claude Code does: spawnSync, no shell, a minimal
# environment. The first argument is the mode. The second is the PATH of the child (empty means
# the minimal PATH). The third is the standard input text.
#   reg  : the registered MCP command, with its last word (mcp) replaced by the rest of argv
#   mcp  : the registered MCP command as it is
#   hook : the registered hook command from settings.json
# It writes the child output to $tmp/l.out and $tmp/l.err and exits with the status of the child.
cat >"$tmp/launch.js" <<'JS'
const fs = require('fs');
const cp = require('child_process');
const [mode, childPath, input, ...rest] = process.argv.slice(2);
const [home, calls, settings, outFile, errFile] = process.env.LS_FILES.split('|');
const win = process.platform === 'win32';
const words = () => {
  const line = fs.readFileSync(calls, 'utf8').replace(/"/g, '').split(/\r?\n/).find((l) => l.includes('mcp add'));
  return line.slice(line.indexOf(' -- ') + 4).trim().split(' ');
};
const env = win
  ? { USERPROFILE: home, SystemRoot: process.env.SystemRoot, APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA, PATH: childPath || process.env.SystemRoot + '\\System32' }
  : { HOME: home, PATH: childPath || '/usr/bin:/bin' };
let command, args;
if (mode === 'hook') {
  const stop = JSON.parse(fs.readFileSync(settings, 'utf8')).hooks.Stop[0].hooks[0];
  if (win) { command = stop.command; args = stop.args; } else { command = '/bin/sh'; args = ['-c', stop.command]; }
} else {
  const w = words();
  command = w[0];
  args = w.slice(1);
  if (mode === 'reg') args = args.slice(0, -1).concat(rest);
}
const r = cp.spawnSync(command, args, { env, input: input ? input + '\n' : input, encoding: 'utf8', timeout: 60000, windowsHide: true });
fs.writeFileSync(outFile, r.stdout || '');
fs.writeFileSync(errFile, (r.stderr || '') + (r.error ? String(r.error.message) : ''));
process.exit(r.status === null ? 99 : r.status);
JS
export LS_FILES="$HOME|$calls|$HOME/.claude/settings.json|$tmp/l.out|$tmp/l.err"
launch() {
  launch_status=0
  node "$tmp/launch.js" "$@" || launch_status=$?
}
expect_version() {
  [ "$launch_status" -eq 0 ] || fail "$1 exited with $launch_status: $(cat "$tmp/l.err")"
  [ "$(tr -d '\r\n' <"$tmp/l.out")" = "$expected" ] || fail "$1 printed '$(cat "$tmp/l.out")', expected '$expected'"
}
# The hook must print nothing and exit 0.
expect_silent_hook() {
  launch hook "" "{}"
  [ "$launch_status" -eq 0 ] || fail "the hook exited with $launch_status: $(cat "$tmp/l.err")"
  [ -z "$(cat "$tmp/l.out" "$tmp/l.err")" ] || fail "the hook printed: $(cat "$tmp/l.out") $(cat "$tmp/l.err")"
}

# Install the package into one Node version and run setup from it.
install_and_setup() {
  prefix=$1 bindir=$2
  PATH="$bindir:$PATH" npm install --global --prefix "$prefix" --no-audit --no-fund --loglevel=error "$tarball"
  entry="$prefix/$cli_rel"
  [ -f "$entry" ] || fail "the installed package has no entry file at $entry"
  : >"$calls"
  setup_status=0
  (PATH="$fakebin_path:$(cd "$bindir" && pwd):$sys_path"; export PATH; "$bindir/$node_name" "$entry" setup claude --yes --hook) </dev/null >"$tmp/setup.out" 2>&1 || setup_status=$?
  cat "$tmp/setup.out"
  [ "$setup_status" -eq 0 ] || fail "gournal setup claude exited with status $setup_status"
}

cd "$tmp/work"

echo "launcher-smoke: gournal setup claude"
install_and_setup "$va" "$va_bin"
grep -q -F 'Check: Claude Code can start gournal without your shell PATH.' "$tmp/setup.out" || fail "setup did not print the launcher check line"
registered=$(tr -d '"\r' <"$calls" | sed -n 's/.* -- //p' | head -n 1)
echo "launcher-smoke: registered command: $registered"
case "$registered" in
  */.gournal/bin/gournal' '* | *'\.gournal\bin\gournal.cmd'*) ;;
  *) fail "the registered command does not run the launcher in .gournal/bin: $registered" ;;
esac

mcp_in='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"launcher-smoke","version":"0.0.0"}}}'

echo "launcher-smoke: minimal PATH"
launch reg "" "" --version
expect_version "--version through the launcher"
launch reg "" "" add "launcher smoke"
[ "$launch_status" -eq 0 ] || fail "add through the launcher exited with $launch_status: $(cat "$tmp/l.err")"
[ -f "$HOME/.gournal/gournal.db" ] || fail "add did not create $HOME/.gournal/gournal.db"
launch mcp "" "$mcp_in"
[ "$launch_status" -eq 0 ] || fail "mcp through the launcher exited with $launch_status: $(cat "$tmp/l.err")"
grep -q '"name":"gournal"' "$tmp/l.out" || fail "the initialize response does not name gournal: $(cat "$tmp/l.out")"
# A transcript with an edit and no add_entry makes the real hook print its reason. A hook that never ran Node prints nothing.
printf '%s\n' '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{}}]}}' >"$tmp/transcript.jsonl"
launch hook "" "$(node -e 'console.log(JSON.stringify({ session_id: "launcher-smoke", transcript_path: process.argv[1] }))' "$tmp/transcript.jsonl")"
[ "$launch_status" -eq 0 ] || fail "the registered hook exited with $launch_status: $(cat "$tmp/l.err")"
grep -q 'logged no work' "$tmp/l.out" || fail "the registered hook did not print its reason: $(cat "$tmp/l.out") $(cat "$tmp/l.err")"

echo "launcher-smoke: default version switch"
launch reg "$child_vb$sep$child_sys" "" --version
expect_version "--version with Node version B first on PATH"

echo "launcher-smoke: removal of the setup Node version"
rm -rf "$va"
launch reg "" "" --version
expect_version "--version after the removal of version A"
recorded=$(tr -d '\r\n' <"$HOME/.gournal/runtime/node" | tr '\\' '/')
case "$recorded" in
  "$va"/*) fail "runtime/node still names version A: $recorded" ;;
esac

echo "launcher-smoke: Node below 22.13"
if [ -z "${GOURNAL_OLD_NODE:-}" ]; then
  echo "launcher-smoke: skipped (set GOURNAL_OLD_NODE to a Node 22.12.0 binary to run it)"
else
  current=$(tr -d '\r\n' <"$HOME/.gournal/runtime/current")
  old_status=0
  "$GOURNAL_OLD_NODE" "$HOME/.gournal/runtime/$current/dist/cli.js" --version >"$tmp/old.out" 2>"$tmp/old.err" || old_status=$?
  [ "$old_status" -eq 1 ] || fail "gournal under Node 22.12 exited with $old_status, expected 1"
  case "$(cat "$tmp/old.err")" in
    'gournal needs Node.js 22.13 or newer.'*) ;;
    *) fail "the message of Node 22.12 is wrong: $(cat "$tmp/old.err")" ;;
  esac
fi

echo "launcher-smoke: package removed without setup claude --uninstall"
rm -f "$HOME/.claude.json"
install_and_setup "$vb" "$vb_bin"
PATH="$vb_bin:$PATH" npm uninstall --global --prefix "$vb" --loglevel=error gournal
[ ! -e "$vb/$cli_rel" ] || fail "npm uninstall left $vb/$cli_rel"
removed_at="$HOME/.gournal/runtime/removed-at"
expect_silent_hook
[ -f "$removed_at" ] || fail "the first hook after the removal did not write removed-at"
# In the grace window the copy runs and stderr holds one notice line.
launch reg "" "" --version
expect_version "--version in the grace window"
[ "$(wc -l <"$tmp/l.err" | tr -d ' ')" -eq 1 ] || fail "stderr in the grace window is not one line: $(cat "$tmp/l.err")"
# After 60 s the MCP server stops with one line. The hook stays silent.
echo $(( $(date +%s) - 61 )) >"$removed_at"
launch mcp "" "$mcp_in"
[ "$launch_status" -eq 1 ] || fail "mcp after the grace window exited with $launch_status, expected 1"
[ ! -s "$tmp/l.out" ] || fail "mcp wrote to stdout: $(cat "$tmp/l.out")"
[ "$(wc -l <"$tmp/l.err" | tr -d ' ')" -eq 1 ] || fail "stderr after the grace window is not one line: $(cat "$tmp/l.err")"
grep -q 'setup claude --uninstall' "$tmp/l.err" || fail "the no-longer-installed line is wrong: $(cat "$tmp/l.err")"
expect_silent_hook

echo "launcher-smoke: OK (gournal $expected)"
