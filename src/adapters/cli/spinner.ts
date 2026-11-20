/** The part of a stream that the spinner uses. process.stderr fits. */
export interface SpinnerStream { isTTY?: boolean; write(chunk: string): boolean }

const FRAMES = ['|', '/', '-', '\\'];
export const FRAME_MS = 80;

/** True only on a real terminal that can redraw a line. */
const canDraw = (stream: SpinnerStream, env: NodeJS.ProcessEnv): boolean =>
  stream.isTTY === true && env.TERM !== 'dumb' && !env.CI;

/**
 * Draw `<frame> <text>` on one line until stop. The first frame comes after FRAME_MS,
 * so a wait that ends at once writes nothing. stop clears the line and is safe to call twice.
 */
export function startSpinner(text: string, stream: SpinnerStream = process.stderr, env: NodeJS.ProcessEnv = process.env): { stop(): void } {
  if (!canDraw(stream, env)) return { stop: () => undefined };
  let frame = 0;
  let drawn = false;
  const timer = setInterval(() => {
    stream.write(`\r${FRAMES[frame++ % FRAMES.length]} ${text}`);
    drawn = true;
  }, FRAME_MS);
  timer.unref();
  let stopped = false;
  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      if (drawn) stream.write(`\r${' '.repeat(text.length + 2)}\r`);
    },
  };
}

/** Run fn with a spinner. The line is clear before fn's result or error reaches the caller. */
export async function withSpinner<T>(text: string, fn: () => Promise<T>, stream?: SpinnerStream): Promise<T> {
  const spinner = startSpinner(text, stream);
  try {
    return await fn();
  } finally {
    spinner.stop();
  }
}
