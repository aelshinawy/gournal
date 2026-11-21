#!/bin/sh
# Launcher smoke test.
# This script mirrors the Node version manager repro. It installs the packed gournal
# into one fake nvm Node version, runs "gournal setup claude", and starts the command
# that setup registered the way Claude Code starts it: no shell, a minimal environment.
# Then it switches the default Node version, removes the Node version that setup used,
# and runs gournal under a Node older than 22.13.
#
# Usage: sh scripts/launcher-smoke.sh
#        GOURNAL_OLD_NODE=/path/to/node-22.12.0 sh scripts/launcher-smoke.sh
#
# GOURNAL_OLD_NODE is optional. It is the path of a Node 22.12.0 binary. Without it, the
# scenario for Node below 22.13 is skipped.
#
# The script never touches the real home. It sets HOME to a temporary folder, refuses to
# run when that folder is the real home or is inside the real ~/.gournal, and removes the
# folder when it exits. It does not set GOURNAL_HOME, so the default home is used inside
# the temporary folder.
#
# The script also runs in Git Bash on Windows. It converts paths with cygpath -m, as
# pack-smoke.sh does, and starts gournal with node, so no cmd quoting applies.

set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"

real_home=$HOME
# Keep the npm cache of the user. HOME changes below, and the cache would move with it.
npm_cache=$(npm config get cache)

case "$(uname -s)" in
  MINGW* | MSYS* | CYGWIN*) windows=1 ;;
  *) windows=0 ;;
esac

tmp=$(mktemp -d "${TMPDIR:-/tmp}/gournal-launcher-smoke.XXXXXX")
if [ "$windows" -eq 1 ]; then
  tmp=$(cygpath -m "$tmp")
fi

cleanup() {
  rm -rf "$tmp" || true
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

fail() {
  echo "launcher-smoke: FAIL: $*" >&2
  exit 1
}

[ "$tmp" != "$real_home" ] || fail "the temporary folder is the real home"
case "$tmp" in
  "$real_home/.gournal" | "$real_home/.gournal/"*) fail "the temporary folder is inside the real ~/.gournal" ;;
esac

mkdir "$tmp/pack" "$tmp/home" "$tmp/work"
export npm_config_cache="$npm_cache"
export HOME="$tmp/home"
export USERPROFILE="$tmp/home"
export GOURNAL_NO_AUTOSYNC=1
unset GOURNAL_HOME
if [ "$windows" -eq 1 ]; then
  mkdir -p "$tmp/home/AppData/Local" "$tmp/home/AppData/Roaming"
  export LOCALAPPDATA="$tmp/home/AppData/Local"
  export APPDATA="$tmp/home/AppData/Roaming"
fi

expected=$(node -p "require('./package.json').version" | tr -d '\r')
ci_node=$(node -p "process.execPath")

echo "launcher-smoke: build and pack"
npm run --silent clean
npm run --silent build
tarball=$(npm pack --silent --pack-destination "$tmp/pack" | tail -n 1 | tr -d '\r')
[ -f "$tmp/pack/$tarball" ] || fail "npm pack did not create $tarball"

# Layout: two copies of the CI Node, as a version manager keeps them. A copy is needed.
# Node reports the real path as execPath, so a symlink would record the CI Node.
if [ "$windows" -eq 1 ]; then
  nodes="$LOCALAPPDATA/nvm"
  va="$nodes/vA"
  vb="$nodes/vB"
  va_bin="$va"
  vb_bin="$vb"
  node_name="node.exe"
  cli="$va/node_modules/gournal/dist/cli.js"
else
  nodes="$HOME/.nvm/versions/node"
  va="$nodes/vA"
  vb="$nodes/vB"
  va_bin="$va/bin"
  vb_bin="$vb/bin"
  node_name="node"
  cli="$va/lib/node_modules/gournal/dist/cli.js"
fi
mkdir -p "$va_bin" "$vb_bin"
cp "$ci_node" "$va_bin/$node_name"
cp "$ci_node" "$vb_bin/$node_name"
chmod +x "$va_bin/$node_name" "$vb_bin/$node_name"

echo "launcher-smoke: install $tarball into version A only"
PATH="$va_bin:$PATH" npm install --global --prefix "$va" --no-audit --no-fund --loglevel=error "$tmp/pack/$tarball"
[ -f "$cli" ] || fail "the installed package has no entry file at $cli"
gournal_a() { "$va_bin/$node_name" "$cli" "$@"; }

# A fake claude records its arguments.
fakebin="$tmp/fakebin"
calls="$tmp/claude-calls.log"
mkdir "$fakebin"
: >"$calls"
if [ "$windows" -eq 1 ]; then
  calls_native=$(cygpath -w "$calls")
  printf '@echo off\r\necho %%* >>"%s"\r\nexit /b 0\r\n' "$calls_native" >"$fakebin/claude.cmd"
  fakebin_path=$(cygpath -u "$fakebin")
  va_path=$(cygpath -u "$va_bin")
  sys_path=$(cygpath -u "$SYSTEMROOT")/System32
  ci_path=$(cygpath -u "$(dirname "$(cygpath -u "$ci_node")")")
  # The child of the helper is a native program. It needs native folders joined with a semicolon.
  child_vb=$(cygpath -w "$vb_bin")
  child_sys="$SYSTEMROOT\\System32"
  child_rest=$(cygpath -w "$fakebin")";$child_sys"
  child_ci=$(cygpath -w "$(dirname "$(cygpath -u "$ci_node")")")
  sep=";"
else
  cat >"$fakebin/claude" <<EOF
#!/bin/sh
printf '%s\n' "\$*" >>"$calls"
exit 0
EOF
  chmod +x "$fakebin/claude"
  fakebin_path="$fakebin"
  va_path="$va_bin"
  sys_path=/usr/bin:/bin
  ci_path=$(dirname "$ci_node")
  child_vb="$vb_bin"
  child_sys="$sys_path"
  child_rest="$fakebin:$sys_path"
  child_ci="$ci_path"
  sep=":"
fi

# The launcher helper starts a command the way Claude Code does: spawnSync, no shell, a
# minimal environment. The first argument is the mode. The second is the PATH of the child
# (empty means the minimal PATH). The third is the standard input text.
#   reg  : the registered MCP command, with its last word (mcp) replaced by the rest of argv
#   mcp  : the registered MCP command as it is
#   hook : the registered hook command from settings.json
# The helper writes the child output to $tmp/l.out and $tmp/l.err and exits with its status.
cat >"$tmp/launch.js" <<'EOF'
const fs = require('fs');
const cp = require('child_process');
const [mode, childPath, input, ...rest] = process.argv.slice(2);
const [home, calls, settings, outFile, errFile] = process.env.LS_FILES.split('|');
const win = process.platform === 'win32';
const words = () => {
  const line = fs.readFileSync(calls, 'utf8').split(/\r?\n/).find((l) => l.includes('mcp add'));
  return line.slice(line.indexOf(' -- ') + 4).replace(/"/g, '').trim().split(' ');
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
EOF
export LS_FILES="$HOME|$calls|$HOME/.claude/settings.json|$tmp/l.out|$tmp/l.err"
launch() {
  launch_status=0
  node "$tmp/launch.js" "$@" || launch_status=$?
}

cd "$tmp/work"

# Setup runs from version A with a PATH that holds the fake claude, version A, and system folders.
echo "launcher-smoke: gournal setup claude"
setup_status=0
(PATH="$fakebin_path:$va_path:$sys_path"; export PATH; gournal_a setup claude --yes --hook) </dev/null >"$tmp/setup.out" 2>&1 || setup_status=$?
cat "$tmp/setup.out"
[ "$setup_status" -eq 0 ] || fail "gournal setup claude --yes --hook exited with status $setup_status"
grep -q -F 'Check: Claude Code can start gournal without your shell PATH.' "$tmp/setup.out" || fail "setup did not print the launcher check line"

# The registered command is the words after "--" in the fake claude log.
tr -d '"\r' <"$calls" >"$tmp/claude-calls.norm"
registered=$(sed -n 's/.* -- //p' "$tmp/claude-calls.norm" | head -n 1)
echo "launcher-smoke: registered command: $registered"
first=$(echo "$registered" | cut -d' ' -f1)
if [ "$windows" -eq 1 ]; then
  case "$first" in *[cC][mM][dD].[eE][xX][eE]) ;; *) fail "the registered command does not start with cmd.exe: $registered" ;; esac
  third=$(echo "$registered" | cut -d' ' -f3)
  case "$third" in *'\.gournal\bin\gournal.cmd') ;; *) fail "the registered launcher is not under .gournal\\bin: $registered" ;; esac
else
  case "$first" in
    /*/.gournal/bin/gournal) ;;
    *) fail "the registered command is not an absolute path that ends in /.gournal/bin/gournal: $registered" ;;
  esac
fi

mcp_in='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"launcher-smoke","version":"0.0.0"}}}'

echo "launcher-smoke: minimal-path-launch"
launch reg "" "" --version
[ "$launch_status" -eq 0 ] || fail "--version through the launcher exited with $launch_status: $(cat "$tmp/l.err")"
[ "$(tr -d '\r\n' <"$tmp/l.out")" = "$expected" ] || fail "--version printed '$(cat "$tmp/l.out")', expected '$expected'"
launch reg "" "" add "launcher smoke"
[ "$launch_status" -eq 0 ] || fail "add through the launcher exited with $launch_status: $(cat "$tmp/l.err")"
[ -f "$HOME/.gournal/gournal.db" ] || fail "add did not create $HOME/.gournal/gournal.db"
launch mcp "" "$mcp_in"
[ "$launch_status" -eq 0 ] || fail "mcp through the launcher exited with $launch_status: $(cat "$tmp/l.err")"
grep -q '"result"' "$tmp/l.out" || fail "the initialize response has no result: $(cat "$tmp/l.out")"
grep -q '"name":"gournal"' "$tmp/l.out" || fail "the initialize response does not name gournal"
launch hook "" "{}"
[ "$launch_status" -eq 0 ] || fail "the registered hook exited with $launch_status: $(cat "$tmp/l.err")"

echo "launcher-smoke: default-version-switch"
launch reg "$child_vb$sep$child_sys" "" --version
[ "$launch_status" -eq 0 ] || fail "--version with Node version B first on PATH exited with $launch_status: $(cat "$tmp/l.err")"
[ "$(tr -d '\r\n' <"$tmp/l.out")" = "$expected" ] || fail "--version printed '$(cat "$tmp/l.out")', expected '$expected'"

echo "launcher-smoke: uninstall-of-setup-version"
rm -rf "$va"
launch reg "" "" --version
[ "$launch_status" -eq 0 ] || fail "--version after the removal of version A exited with $launch_status: $(cat "$tmp/l.err")"
[ "$(tr -d '\r\n' <"$tmp/l.out")" = "$expected" ] || fail "--version printed '$(cat "$tmp/l.out")', expected '$expected'"
recorded=$(tr -d '\r\n' <"$HOME/.gournal/runtime/node")
case "$recorded" in
  "$va"/*) fail "runtime/node still names version A: $recorded" ;;
esac
echo "launcher-smoke: runtime/node is now $recorded"

echo "launcher-smoke: node-below-22.13"
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
  ! grep -q ERR_UNKNOWN_BUILTIN_MODULE "$tmp/old.err" || fail "Node 22.12 printed ERR_UNKNOWN_BUILTIN_MODULE"

  if [ "$windows" -eq 0 ]; then
    # Only the old Node is left in the nvm folder. The launcher must skip it and look further.
    # The result depends on the runner: a system Node that passes the probe is used.
    rm -rf "$vb"
    mkdir -p "$nodes/vOld/bin"
    cp "$GOURNAL_OLD_NODE" "$nodes/vOld/bin/node"
    chmod +x "$nodes/vOld/bin/node"
    printf '%s\n' "$nodes/vOld/bin/node" >"$HOME/.gournal/runtime/node"
    # Compute the expected result with the probe of the launcher on every system candidate.
    system=$(node -e 'console.log(require(process.argv[1]).POSIX_CANDIDATES.system.join("\n"))' "$root/dist/adapters/setup/launcher.js")
    probe='var v=process.versions.node.split(".").map(Number);if(!(v[0]>22||(v[0]===22&&v[1]>=13)))process.exit(1);require("node:sqlite")'
    good=""
    for n in $system /opt/homebrew/opt/node@*/bin/node /usr/local/opt/node@*/bin/node /home/linuxbrew/.linuxbrew/opt/node@*/bin/node /usr/local/n/versions/node/*/bin/node; do
      if [ -f "$n" ] && [ -x "$n" ] && "$n" -e "$probe" </dev/null >/dev/null 2>&1; then good="$n"; fi
    done
    launch reg "" "" --version
    if [ -n "$good" ]; then
      [ "$launch_status" -eq 0 ] || fail "a system Node passes ($good), but the launcher exited with $launch_status: $(cat "$tmp/l.err")"
      [ "$(tr -d '\r\n' <"$tmp/l.out")" = "$expected" ] || fail "--version printed '$(cat "$tmp/l.out")', expected '$expected'"
    else
      [ "$launch_status" -eq 1 ] || fail "no system Node passes, and the launcher exited with $launch_status, expected 1"
      want='gournal: found no Node.js 22.13 or newer with the node:sqlite module. Install Node.js 22.13 or newer. Then run "gournal setup claude" in a terminal.'
      [ "$(tr -d '\r' <"$tmp/l.err")" = "$want" ] || fail "the no-node line is wrong: $(cat "$tmp/l.err")"
    fi
    ! grep -q ERR_UNKNOWN_BUILTIN_MODULE "$tmp/l.err" || fail "the launcher printed ERR_UNKNOWN_BUILTIN_MODULE"
  fi
fi

echo "launcher-smoke: uninstall"
# Version A is gone, so run the launcher. The launcher runs the copy of gournal in the runtime folder.
# Put a good Node on the PATH of the child, because the old Node may be the only recorded one.
launch reg "$child_ci$sep$child_rest" "" setup claude --uninstall --yes
[ "$launch_status" -eq 0 ] || fail "uninstall exited with $launch_status: $(cat "$tmp/l.err") $(cat "$tmp/l.out")"
[ ! -e "$HOME/.gournal/bin/gournal" ] && [ ! -e "$HOME/.gournal/bin/gournal.cmd" ] || fail "uninstall left the launcher"
[ ! -e "$HOME/.gournal/runtime" ] || fail "uninstall left the runtime folder"
[ -f "$HOME/.gournal/gournal.db" ] || fail "uninstall removed the journal file"

echo "launcher-smoke: OK (gournal $expected)"
