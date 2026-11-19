// Child process for test/render/day-header.test.ts. It prints one JSON line.
// The test sets TZ in the child env. The entry is on Sunday 29 March 2026 in New York.
import chalk from 'chalk';
import { buildWorkLog, resolvePeriod } from '../../../src/core';
import { workLogMarkdown, workLogText } from '../../../src/render';
import { makeEntry } from '../../core/factory';

chalk.level = 0;

const now = new Date('2026-03-29T18:00:00.000Z');
const entry = makeEntry({ createdAt: '2026-03-29T12:00:00.000Z' });
const model = buildWorkLog(resolvePeriod({ from: '2026-03-29', to: '2026-03-29' }, now, 1), [entry]);
const md = workLogMarkdown(model).split('\n').find((l) => l.startsWith('### ')) ?? '';

process.stdout.write(`${JSON.stringify({ zone: Intl.DateTimeFormat().resolvedOptions().timeZone, md, term: workLogText(model) })}\n`);
