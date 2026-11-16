#!/bin/sh
# Pack smoke test.
# This script builds gournal, packs it, installs the tarball into a temporary
# prefix, and runs the installed binary. It proves that the package that npm
# publishes works, not only the source tree.
#
# Usage: sh scripts/pack-smoke.sh
#
# The script never touches the real ~/.gournal or ~/.claude. It sets HOME and
# GOURNAL_HOME to temporary folders and removes them when it exits.
#
# The script also runs in Git Bash on Windows. Native programs such as node and
# npm do not understand MSYS paths like /tmp/x. The script converts the
# temporary folder to the mixed form (C:/Users/...) with cygpath -m. Every path
# that node or npm reads then works.

set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"

# Keep the npm cache of the user. HOME changes below, and the cache would move with it.
npm_cache=$(npm config get cache)

# Detect Git Bash, MSYS2, and Cygwin on Windows.
case "$(uname -s)" in
  MINGW* | MSYS* | CYGWIN*) windows=1 ;;
  *) windows=0 ;;
esac

tmp=$(mktemp -d "${TMPDIR:-/tmp}/gournal-pack-smoke.XXXXXX")
if [ "$windows" -eq 1 ]; then
  # Use the mixed form for every path. Bash and native programs both accept it.
  tmp=$(cygpath -m "$tmp")
fi
mcp_pid=""

cleanup() {
  if [ -n "$mcp_pid" ]; then
    kill "$mcp_pid" 2>/dev/null || true
  fi
  rm -rf "$tmp" || true
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

fail() {
  echo "pack-smoke: FAIL: $*" >&2
  exit 1
}

mkdir "$tmp/pack" "$tmp/prefix" "$tmp/home" "$tmp/gournal-home" "$tmp/work"

# Isolate every gournal and npm run from the real home folder.
export npm_config_cache="$npm_cache"
export HOME="$tmp/home"
export USERPROFILE="$tmp/home"
export GOURNAL_HOME="$tmp/gournal-home"
export GOURNAL_NO_AUTOSYNC=1

# Remove carriage returns, so a Windows tool cannot break a comparison.
expected=$(node -p "require('./package.json').version" | tr -d '\r')

echo "pack-smoke: build"
npm run --silent clean
npm run --silent build

echo "pack-smoke: pack"
tarball=$(npm pack --silent --pack-destination "$tmp/pack" | tail -n 1 | tr -d '\r')
[ -f "$tmp/pack/$tarball" ] || fail "npm pack did not create $tarball"

# The tarball must hold only the files that users need. A new top-level folder (for example
# site/ or test/) must not ship by accident. Allowed: dist/, README.md, LICENSE, package.json.
# List the tarball from its own folder. A drive path like C:/x makes GNU tar look for a host.
echo "pack-smoke: check the tarball contents"
(cd "$tmp/pack" && tar -tzf "$tarball") | tr -d '\r' >"$tmp/tarball.list"
extra=$(grep -v -E '^package/(dist/.+|README\.md|LICENSE|package\.json)$' "$tmp/tarball.list" | grep -v -E '/$' || true)
[ -z "$extra" ] || fail "the tarball has files outside the allowlist (dist/, README.md, LICENSE, package.json): $extra"
grep -q -x 'package/dist/cli.js' "$tmp/tarball.list" || fail "the tarball has no package/dist/cli.js"
# Size guard. The tarball was about 80 kB when this check was added. Raise the limit on purpose, not by accident.
max_tarball_bytes=200000
tarball_bytes=$(wc -c <"$tmp/pack/$tarball" | tr -d ' \r')
[ "$tarball_bytes" -le "$max_tarball_bytes" ] || fail "the tarball is $tarball_bytes bytes. The limit is $max_tarball_bytes."
echo "pack-smoke: tarball ok ($(wc -l <"$tmp/tarball.list" | tr -d ' ') entries, $tarball_bytes bytes)"

echo "pack-smoke: install $tarball"
npm install --global --prefix "$tmp/prefix" --no-audit --no-fund --loglevel=error "$tmp/pack/$tarball"
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
# This step runs the installed gournal against a fake claude on PATH. No real Claude CLI is needed.
# The fake claude writes its arguments to a log. HOME and USERPROFILE point to the temporary home.
fakebin="$tmp/fakebin"
calls="$tmp/claude-calls.log"
mkdir "$fakebin"
: >"$calls"
if [ "$windows" -eq 1 ]; then
  # An npm install of Claude Code on Windows is a claude.cmd shim. Node cannot start a .cmd file
  # without a shell, so gournal retries through cmd.exe. A claude.cmd file exercises that retry.
  # cmd.exe needs the Windows form of the log path. CRLF line endings are the batch file norm.
  calls_native=$(cygpath -w "$calls")
  printf '@echo off\r\necho %%* >>"%s"\r\nexit /b 0\r\n' "$calls_native" >"$fakebin/claude.cmd"
  # Bash converts PATH for native programs only when each entry is in the MSYS form.
  fakebin_path=$(cygpath -u "$fakebin")
else
  # The heredoc is not quoted. The shell fills in $calls now and keeps \$* for the fake script.
  cat >"$fakebin/claude" <<EOF
#!/bin/sh
printf '%s\n' "\$*" >>"$calls"
exit 0
EOF
  chmod +x "$fakebin/claude"
  fakebin_path="$fakebin"
fi

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
# Check the shape of hooks.Stop[0].hooks[0]. The first argument is the file. The second is 1 on Windows.
node -e '
const fs = require("fs");
const settings = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const windows = process.argv[2] === "1";
const stop = settings.hooks && settings.hooks.Stop;
const group = Array.isArray(stop) ? stop[0] : undefined;
const hook = group && Array.isArray(group.hooks) ? group.hooks[0] : undefined;
const fail = (m) => { console.error("pack-smoke: FAIL: " + m); process.exit(1); };
if (!hook) fail("settings.json has no hooks.Stop[0].hooks[0]");
if (typeof hook.command !== "string") fail("the hook command is not a string");
if (windows) {
  if (!/node\.exe$/i.test(hook.command)) fail("the hook command does not end with node.exe: " + hook.command);
  const a = hook.args;
  if (!Array.isArray(a) || a.length < 2) fail("the hook args are not an array of two or more items");
  if (a[a.length - 2] !== "hook" || a[a.length - 1] !== "stop") fail("the hook args do not end with hook, stop: " + JSON.stringify(a));
} else {
  if (hook.args !== undefined) fail("the hook has args on a POSIX system");
  if (!hook.command.includes("hook stop")) fail("the hook command does not hold the words hook stop: " + hook.command);
}
' "$settings" "$windows" || fail "the Stop hook in settings.json has the wrong shape"
[ -f "$skill" ] || fail "setup did not write $skill"

# Uninstall. The fake claude never writes ~/.claude.json, so setup finds no MCP registration
# and does not call claude mcp remove. Uninstall must still remove the skill and the hook.
uninstall_status=0
run_setup --uninstall --yes || uninstall_status=$?
cat "$tmp/setup.out"
[ "$uninstall_status" -eq 0 ] || fail "gournal setup claude --uninstall --yes exited with status $uninstall_status"
[ ! -e "$skill" ] || fail "uninstall did not remove $skill"
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
