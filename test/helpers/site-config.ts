import path from 'path';
import { execFileSync } from 'child_process';
import { pathToFileURL } from 'url';

// site/site.config.mjs is an ES module, so read it in a node child process.
// The child sees SITE_URL, so a build with an override and its test agree.
const configUrl = pathToFileURL(path.resolve(__dirname, '../../site/site.config.mjs')).href;

const script =
  `import { SITE_URL, siteUrl } from ${JSON.stringify(configUrl)};` +
  `console.log(JSON.stringify({ SITE_URL, canonical: siteUrl(), og: siteUrl('og.png') }));`;

export const siteConfig: { SITE_URL: string; canonical: string; og: string } = JSON.parse(
  execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' })
);
