#!/bin/sh
# Pack smoke test.
# This script packs gournal (see smoke-lib.sh), installs the tarball into a temporary
# prefix, and runs the installed binary. It proves that the package that npm
# publishes works, not only the source tree.
#
# Usage: sh scripts/pack-smoke.sh
#
# The script sets HOME and GOURNAL_HOME to temporary folders and removes them when it exits.
# GOURNAL_TARBALL names a packed tarball. Without it, the script builds and packs one.

set -eu

. "$(dirname "$0")/smoke-lib.sh"
smoke_init pack-smoke
mcp_pid=""
on_exit='[ -z "$mcp_pid" ] || kill "$mcp_pid" 2>/dev/null || true'

mkdir "$tmp/prefix" "$tmp/gournal-home"
export GOURNAL_HOME="$tmp/gournal-home"

smoke_pack

# The tarball must hold only the files that users need. A new top-level folder (for example
# site/ or test/) must not ship by accident. Allowed: dist/, README.md, LICENSE, package.json.
# List the tarball from its own folder. A drive path like C:/x makes GNU tar look for a host.
echo "pack-smoke: check the tarball contents"
(cd "$(dirname "$tarball")" && tar -tzf "$(basename "$tarball")") | tr -d '\r' >"$tmp/tarball.list"
extra=$(grep -v -E '^package/(dist/.+|README\.md|LICENSE|package\.json)$' "$tmp/tarball.list" | grep -v -E '/$' || true)
[ -z "$extra" ] || fail "the tarball has files outside the allowlist (dist/, README.md, LICENSE, package.json): $extra"
grep -q -x 'package/dist/cli.js' "$tmp/tarball.list" || fail "the tarball has no package/dist/cli.js"
# Size guard. The tarball was about 80 kB when this check was added. Raise the limit on purpose, not by accident.
max_tarball_bytes=200000
tarball_bytes=$(wc -c <"$tarball" | tr -d ' \r')
[ "$tarball_bytes" -le "$max_tarball_bytes" ] || fail "the tarball is $tarball_bytes bytes. The limit is $max_tarball_bytes."
echo "pack-smoke: tarball ok ($(wc -l <"$tmp/tarball.list" | tr -d ' ') entries, $tarball_bytes bytes)"

echo "pack-smoke: install $tarball"
npm install --global --prefix "$tmp/prefix" --no-audit --no-fund --loglevel=error "$tarball"
if [ "$windows" -eq 1 ]; then
  # On Windows, npm puts the shims in the prefix folder and has no bin folder.
  [ -f "$tmp/prefix/gournal.cmd" ] || fail "the installed package has no shim at $tmp/prefix/gournal.cmd"
  # Run the installed package with node. This avoids the quoting rules of cmd.
  bin="$tmp/prefix/node_modules/gournal/dist/cli.js"
  [ -f "$bin" ] || fail "the installed package has no entry file at $bin"
  gournal() { node "$bin" "$@"; }
else
  bin="$tmp/prefix/bin/gournal"
  [ -x "$bin" ] || fail "the installed package has no executable at $bin"
  gournal() { "$bin" "$@"; }
fi

# Run from an empty folder that is not a Git repository.
cd "$tmp/work"

echo "pack-smoke: gournal --version"
actual=$(gournal --version | tr -d '\r')
echo "$actual"
[ "$actual" = "$expected" ] || fail "version is '$actual', expected '$expected'"

echo "pack-smoke: gournal add"
gournal add "pack smoke" >"$tmp/add.out"
cat "$tmp/add.out"

echo "pack-smoke: gournal find"
gournal find smoke >"$tmp/find.out"
cat "$tmp/find.out"
grep -q "pack smoke" "$tmp/find.out" || fail "find did not return the entry"

echo "pack-smoke: gournal standup"
gournal standup >"$tmp/standup.out"
cat "$tmp/standup.out"
grep -q "pack smoke" "$tmp/standup.out" || fail "standup did not list the entry"

echo "pack-smoke: gournal mcp initialize"
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"pack-smoke","version":"0.0.0"}}}' >"$tmp/mcp.in"
# Standard input comes from a file, so the server sees the end of input after the request.
# Start the program directly, not through a shell function. Then $! is the pid of
# the server and not the pid of a subshell.
if [ "$windows" -eq 1 ]; then
  node "$bin" mcp <"$tmp/mcp.in" >"$tmp/mcp.out" 2>"$tmp/mcp.err" &
else
  "$bin" mcp <"$tmp/mcp.in" >"$tmp/mcp.out" 2>"$tmp/mcp.err" &
fi
mcp_pid=$!

waited=0
while kill -0 "$mcp_pid" 2>/dev/null; do
  if [ "$waited" -ge 20 ]; then
    fail "gournal mcp did not exit within 20 seconds after standard input closed"
  fi
  sleep 1
  waited=$((waited + 1))
done
mcp_status=0
wait "$mcp_pid" || mcp_status=$?
mcp_pid=""
[ "$mcp_status" -eq 0 ] || fail "gournal mcp exited with status $mcp_status: $(cat "$tmp/mcp.err")"

cat "$tmp/mcp.out"
grep -q '"result"' "$tmp/mcp.out" || fail "the initialize response has no result"
grep -q '"name":"gournal"' "$tmp/mcp.out" || fail "the initialize response does not name the gournal server"

echo "pack-smoke: gournal setup claude"
# The installed gournal runs against a fake claude on PATH. No real Claude CLI is needed.
calls="$tmp/claude-calls.log"
write_fake_claude "$calls" "$tmp/fakebin"

# Run gournal in a subshell, so the changed PATH stays inside it. --yes means nothing waits for input.
# The input comes from /dev/null as a second guard. A failure is a status, not an exit of this script.
run_setup() {
  (
    PATH="$fakebin_path:$PATH"
    export PATH
    gournal setup claude "$@"
  ) </dev/null >"$tmp/setup.out" 2>&1
}

settings="$HOME/.claude/settings.json"
skill="$HOME/.claude/skills/gournal/SKILL.md"

setup_status=0
run_setup --yes --hook || setup_status=$?
cat "$tmp/setup.out"
[ "$setup_status" -eq 0 ] || fail "gournal setup claude --yes --hook exited with status $setup_status"

# The fake claude log can hold carriage returns and double quotes. cmd.exe quotes each argument.
tr -d '"\r' <"$calls" >"$tmp/claude-calls.norm"
echo "pack-smoke: claude was called with:"
cat "$tmp/claude-calls.norm"
grep -q -F 'mcp add' "$tmp/claude-calls.norm" || fail "setup did not run 'claude mcp add' (log: $calls)"
grep -q -F -e '--scope user' "$tmp/claude-calls.norm" || fail "the claude call has no '--scope user'"
grep -q -F 'gournal' "$tmp/claude-calls.norm" || fail "the claude call does not name gournal"

[ -f "$settings" ] || fail "setup did not write $settings"
grep -q -F 'hook' "$settings" || fail "settings.json has no 'hook' word"
grep -q -F 'stop' "$settings" || fail "settings.json has no 'stop' word"
if [ "$windows" -eq 1 ]; then
  grep -q -F '"args"' "$settings" || fail "settings.json has no exec form hook (no \"args\")"
else
  if grep -q -F '"args"' "$settings"; then fail "settings.json has an exec form hook on a POSIX system"; fi
fi
# The launcher is a file in $GOURNAL_HOME/bin. The hook holds its path in the form of the platform.
if [ "$windows" -eq 1 ]; then
  launcher="$GOURNAL_HOME/bin/gournal.cmd"
  launcher_native=$(cygpath -w "$launcher")
else
  # A TMPDIR with a trailing slash gives a double slash. Setup joins paths, so it writes one slash.
  launcher=$(printf '%s' "$GOURNAL_HOME/bin/gournal" | sed 's|//*|/|g')
  launcher_native="$launcher"
fi
[ -f "$launcher" ] || fail "setup did not write the launcher $launcher"
# Check the shape of hooks.Stop[0].hooks[0]. The arguments are the file, 1 on Windows, and the
# expected launcher path. The launcher is in $GOURNAL_HOME/bin, not in the real home.
node -e '
const fs = require("fs");
const settings = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const windows = process.argv[2] === "1";
const launcher = process.argv[3];
const stop = settings.hooks && settings.hooks.Stop;
const group = Array.isArray(stop) ? stop[0] : undefined;
const hook = group && Array.isArray(group.hooks) ? group.hooks[0] : undefined;
const fail = (m) => { console.error("pack-smoke: FAIL: " + m); process.exit(1); };
if (!hook) fail("settings.json has no hooks.Stop[0].hooks[0]");
if (typeof hook.command !== "string") fail("the hook command is not a string");
if (windows) {
  if (!/cmd\.exe$/i.test(hook.command)) fail("the hook command does not end with cmd.exe: " + hook.command);
  const a = hook.args;
  const want = ["/d", "/c", launcher, "hook", "stop"];
  if (!Array.isArray(a) || a.length !== want.length || a.some((x, i) => x !== want[i])) fail("the hook args are " + JSON.stringify(a) + ", expected " + JSON.stringify(want));
} else {
  if (hook.args !== undefined) fail("the hook has args on a POSIX system");
  // The same quoting as shellQuote in src/adapters/setup/command.ts. \x27 is a single quote.
  const q = /^[\w@%+=:,.\/-]+$/.test(launcher) ? launcher : "\x27" + launcher.replace(/\x27/g, "\x27\\\x27\x27") + "\x27";
  const want = q + " hook stop";
  if (hook.command !== want) fail("the hook command is " + hook.command + ", expected " + want);
}
' "$settings" "$windows" "$launcher_native" || fail "the Stop hook in settings.json has the wrong shape"
[ -f "$skill" ] || fail "setup did not write $skill"

# Uninstall. The fake claude never writes ~/.claude.json, so setup finds no MCP registration
# and does not call claude mcp remove. Uninstall must still remove the skill and the hook.
uninstall_status=0
run_setup --uninstall --yes || uninstall_status=$?
cat "$tmp/setup.out"
[ "$uninstall_status" -eq 0 ] || fail "gournal setup claude --uninstall --yes exited with status $uninstall_status"
[ ! -e "$skill" ] || fail "uninstall did not remove $skill"
[ ! -e "$launcher" ] || fail "uninstall did not remove the launcher $launcher"
if [ -f "$settings" ]; then
  # No hook entry may keep a command or args that mention hook or stop.
  node -e '
const fs = require("fs");
const settings = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const groups = (settings.hooks && settings.hooks.Stop) || [];
const text = JSON.stringify(groups);
if (/hook|stop/i.test(text.replace(/"Stop"/g, ""))) {
  console.error("pack-smoke: FAIL: a Stop hook is left in settings.json: " + text);
  process.exit(1);
}
' "$settings" || fail "uninstall left the Stop hook in settings.json"
fi

echo "pack-smoke: OK (gournal $actual)"
