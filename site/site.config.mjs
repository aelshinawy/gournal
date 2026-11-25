// The one place that names where the site lives and how it shares.
// SITE_URL has no trailing slash. The site is served from the root path.
// The env override lets a test build try another host without editing this file.
export const SITE_URL = process.env.SITE_URL ?? 'https://gournal.aelshinawy.com';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
export const OG_ALT = 'A gournal standup in the terminal: done work by project, blockers, next items, and linked GitHub activity.';

// The absolute URL of a site path, for example siteUrl('og.png').
export function siteUrl(path = '') {
  return new URL(`/${path.replace(/^\//, '')}`, SITE_URL).href;
}
