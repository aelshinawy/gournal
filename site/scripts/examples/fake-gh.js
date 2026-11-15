#!/usr/bin/env node
// Stand-in gh for the docs examples. It prints fixture data for the `acme` and `octo` owners.
// Times are relative to now, so the activity falls in today's standup window.
const args = process.argv.slice(2).join(' ');
const ago = (hours) => new Date(Date.now() - hours * 3600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const out = (v) => process.stdout.write(JSON.stringify(v) + '\n');

if (args === 'api user') out({ login: 'dev' });
else if (args.includes('q=is:pr author:')) {
  out({ items: [{ number: 412, title: 'Fix invoice rounding', repository_url: 'https://api.github.com/repos/acme/billing-api', user: { login: 'dev' }, updated_at: ago(0.5) }] });
} else if (args.includes('q=is:pr reviewed-by:')) {
  out({ items: [{ number: 88, title: 'Dark mode tokens', repository_url: 'https://api.github.com/repos/octo/web', user: { login: 'sam' }, updated_at: ago(2) }] });
} else if (args === 'api repos/acme/billing-api/pulls/412') {
  out({ number: 412, title: 'Fix invoice rounding', state: 'closed', draft: false, html_url: 'https://github.com/acme/billing-api/pull/412',
    created_at: ago(30), merged_at: ago(0.5), merged_by: { login: 'sam' }, head: { ref: 'fix/invoice-rounding' }, base: { ref: 'main' }, user: { login: 'dev' } });
} else if (args.includes('repos/acme/billing-api/pulls/412/commits')) {
  out([{ sha: 'a41c9e2f0b7d3c18e5a6f0912b3c4d5e6f708192', html_url: 'https://github.com/acme/billing-api/commit/a41c9e2', author: { login: 'dev' }, commit: { message: 'Round after tax', author: { date: ago(1) } } }]);
} else if (args.includes('repos/octo/web/pulls/88/reviews')) {
  out([{ id: 9001, state: 'APPROVED', submitted_at: ago(2), html_url: 'https://github.com/octo/web/pull/88#pullrequestreview-9001', user: { login: 'dev' } }]);
} else {
  process.stderr.write(`no route: ${args}\n`);
  process.exit(1);
}
