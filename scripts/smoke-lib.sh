# Shared helpers of pack-smoke.sh and launcher-smoke.sh. Source this file. Do not run it.
#
# smoke_init NAME makes a temporary folder, points HOME at it, and refuses to run when that
# folder is the real home or is inside the real ~/.gournal. It removes the folder on exit.
# GOURNAL_TARBALL names a packed tarball. CI sets it so the jobs pack once.
# The scripts also run in Git Bash on Windows. Native programs do not read MSYS paths, so
# every path that node or npm reads uses the mixed form from cygpath -m.

smoke_init() {
  name=$1
  root=$(cd "$(dirname "$0")/.." && pwd)
  cd "$root"
  real_home=$HOME
  # HOME changes below, and the npm cache would move with it.
  npm_cache=$(npm config get cache)
  case "$(uname -s)" in
    MINGW* | MSYS* | CYGWIN*) windows=1 ;;
    *) windows=0 ;;
  esac
  tmp=$(mktemp -d "${TMPDIR:-/tmp}/gournal-$name.XXXXXX")
  [ "$windows" -eq 0 ] || tmp=$(cygpath -m "$tmp")
  on_exit=""
  trap '
    eval "$on_exit"
    cd "$root" 2>/dev/null || cd / || true
    rm -rf "$tmp" || true
  ' EXIT
  trap 'exit 1' HUP INT TERM

  case "$tmp" in
    *" "*) fail "the temporary folder path holds a space: $tmp. Set TMPDIR to a folder without a space." ;;
  esac
  # Compare the canonical forms: the long mixed form on Windows, the physical path on POSIX.
  if [ "$windows" -eq 1 ]; then
    canon_tmp=$(cygpath -ml "$tmp")
    canon_home=$(cygpath -ml "$real_home")
  else
    canon_tmp=$(cd -P "$tmp" && pwd -P)
    canon_home=$(cd -P "$real_home" && pwd -P)
  fi
  [ "$canon_tmp" != "$canon_home" ] || fail "the temporary folder is the real home"
  case "$canon_tmp" in
    "$canon_home/.gournal" | "$canon_home/.gournal/"*) fail "the temporary folder is inside the real ~/.gournal" ;;
  esac

  mkdir "$tmp/pack" "$tmp/home" "$tmp/work"
  export npm_config_cache="$npm_cache"
  export HOME="$tmp/home"
  export USERPROFILE="$tmp/home"
  export GOURNAL_NO_AUTOSYNC=1
  unset GOURNAL_HOME NVM_DIR FNM_DIR VOLTA_HOME XDG_DATA_HOME XDG_CONFIG_HOME ASDF_DATA_DIR MISE_DATA_DIR NODENV_ROOT N_PREFIX
  if [ "$windows" -eq 1 ]; then
    mkdir -p "$tmp/home/AppData/Local" "$tmp/home/AppData/Roaming"
    export LOCALAPPDATA="$tmp/home/AppData/Local"
    export APPDATA="$tmp/home/AppData/Roaming"
  fi
  # tr removes carriage returns, so a Windows tool cannot break a comparison.
  expected=$(node -p "require('./package.json').version" | tr -d '\r')
}

fail() {
  echo "$name: FAIL: $*" >&2
  exit 1
}

# Set tarball to the path of the packed gournal. Build and pack unless GOURNAL_TARBALL is set.
smoke_pack() {
  if [ -n "${GOURNAL_TARBALL:-}" ]; then
    tarball=$GOURNAL_TARBALL
    [ "$windows" -eq 0 ] || tarball=$(cygpath -m "$tarball")
  else
    echo "$name: build and pack"
    npm run --silent clean
    npm run --silent build
    packed=$(npm pack --silent --pack-destination "$tmp/pack" | tail -n 1 | tr -d '\r')
    tarball="$tmp/pack/$packed"
  fi
  [ -f "$tarball" ] || fail "the tarball $tarball does not exist"
}

# write_fake_claude LOG DIR makes a claude in DIR that appends its arguments to LOG.
# Set fakebin_path to DIR in the form of the PATH of the platform.
write_fake_claude() {
  mkdir "$2"
  : >"$1"
  if [ "$windows" -eq 1 ]; then
    # An npm install of Claude Code on Windows is a claude.cmd shim. Node cannot start it without
    # a shell, so gournal retries through cmd.exe. The batch file needs the Windows form of the log path.
    printf '@echo off\r\necho %%* >>"%s"\r\nexit /b 0\r\n' "$(cygpath -w "$1")" >"$2/claude.cmd"
    fakebin_path=$(cygpath -u "$2")
  else
    # The heredoc is not quoted. The shell fills in $1 now and keeps \$* for the fake script.
    cat >"$2/claude" <<FAKE
#!/bin/sh
printf '%s\n' "\$*" >>"$1"
exit 0
FAKE
    chmod +x "$2/claude"
    fakebin_path="$2"
  fi
}
