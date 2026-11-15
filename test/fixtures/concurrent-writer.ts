import { updateEntries } from '../../src/storage';
import type { Entry } from '../../src/types';

const [file, id, count] = process.argv.slice(2);

function entryFor(writer: string, i: number): Entry {
  return {
    timestamp: new Date().toISOString(),
    message: `writer-${writer}-entry-${i}`,
    project: 'concurrency',
    tags: [],
  };
}

async function main(): Promise<void> {
  for (let i = 0; i < Number(count); i++) {
    await updateEntries(e => [...e, entryFor(id, i)], file);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
