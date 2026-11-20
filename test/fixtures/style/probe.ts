// Child process for test/render/style.test.ts. It prints one JSON line.
// The test controls the color decision through the child env and these switches:
// PROBE_TTY=1 fakes a TTY on stdout. PROBE_FORCE=on or off calls the test seam first.
import tty from 'tty';
import { tagCountsText } from '../../../src/render';
import { forceColor } from '../../../src/render/style';

if (process.env.PROBE_TTY === '1') {
  Object.defineProperty(process.stdout, 'isTTY', { value: true });
  process.stdout.getColorDepth = tty.WriteStream.prototype.getColorDepth;
}
if (process.env.PROBE_FORCE === 'on') forceColor(true);
if (process.env.PROBE_FORCE === 'off') forceColor(false);

process.stdout.write(`${JSON.stringify(tagCountsText([]))}\n`);
