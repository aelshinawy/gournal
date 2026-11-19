// Child process for test/render/style.test.ts. It prints one JSON line.
// The test controls the color decision through the child env.
import { tagCountsText } from '../../../src/render';

process.stdout.write(`${JSON.stringify(tagCountsText([]))}\n`);
