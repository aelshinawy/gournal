import { createInterface } from 'node:readline/promises';

export interface ConfirmStreams { input: NodeJS.ReadableStream & { isTTY?: boolean }; output: NodeJS.WritableStream }

/** The old prompt rule: y or yes is true, n or no is false, anything else is the default. */
const answerOf = (answer: string, def: boolean): boolean => (/^(y|yes)/i.test(answer) ? true : /^(n|no)/i.test(answer) ? false : def);

/**
 * Ask a yes or no question on the terminal. Reject when the input is not a terminal,
 * when the input closes, or on Ctrl+C. The caller decides what no answer means.
 */
export async function confirm(message: string, def: boolean, streams: ConfirmStreams = { input: process.stdin, output: process.stdout }): Promise<boolean> {
  if (streams.input.isTTY !== true) throw new Error('no terminal to ask');
  const rl = createInterface({ input: streams.input, output: streams.output });
  const ac = new AbortController();
  const abort = (): void => ac.abort();
  rl.once('close', abort);
  rl.once('SIGINT', abort);
  try {
    return answerOf(await rl.question(`? ${message} ${def ? '(Y/n)' : '(y/N)'} `, { signal: ac.signal }), def);
  } catch {
    throw new Error('no answer');
  } finally {
    rl.off('close', abort);
    rl.close();
  }
}

/** confirm, but no terminal or no answer is no. The default CliIo.confirm for setup claude. */
export const confirmOrNo = (message: string, def: boolean, streams?: ConfirmStreams): Promise<boolean> =>
  confirm(message, def, streams).catch(() => false);
