'use strict';
// Test double for gh. FAKE_GH_MODE selects the stderr text and exit code.
// Tests run it with the Node binary, because Windows cannot start a shell script.
const fail = (text, code) => {
  process.stderr.write(text);
  process.exitCode = code;
};

switch (process.env.FAKE_GH_MODE) {
  case 'auth':
    fail('To get started with GitHub CLI, please run:  gh auth login\n', 4);
    break;
  case 'rate-limit':
    fail('gh: HTTP 403: API rate limit exceeded\n', 1);
    break;
  case 'network':
    fail('error connecting to api.github.com\n', 1);
    break;
  case 'sleep':
    setTimeout(() => {}, 5000);
    break;
  case 'other':
    fail('something odd\nsecond line\n', 1);
    break;
  case 'args':
    process.stdout.write(JSON.stringify(process.argv.slice(2)));
    break;
  default:
    process.stdout.write('{"ok":true}\n');
}
