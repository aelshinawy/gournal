// The one place that names where the site lives.
// Change these two values to move the site. Everything else in site/ derives from them.
// SITE_URL has no trailing slash. BASE starts and ends with a slash.
// Env overrides exist so a test build can try another base without editing this file.
export const SITE_URL = process.env.SITE_URL ?? 'https://gournal.aelshinawy.com';
export const BASE = process.env.SITE_BASE ?? '/';

// The absolute URL of a site path, for example siteUrl('og.png').
export function siteUrl(path = '') {
  return new URL(BASE + path.replace(/^\//, ''), SITE_URL).href;
}
