#!/bin/sh
# Test double for gh. FAKE_GH_MODE selects the stderr text and exit code.
case "$FAKE_GH_MODE" in
  auth) echo "To get started with GitHub CLI, please run:  gh auth login" >&2; exit 4 ;;
  rate-limit) echo "gh: HTTP 403: API rate limit exceeded" >&2; exit 1 ;;
  network) echo "error connecting to api.github.com" >&2; exit 1 ;;
  sleep) exec sleep 5 ;;
  other) printf 'something odd\nsecond line\n' >&2; exit 1 ;;
  *) echo '{"ok":true}' ;;
esac
