// Import this file before anything that loads node:sqlite. It hides only the SQLite
// ExperimentalWarning. Every other warning stays visible.
type Emit = typeof process.emitWarning;

const isSqliteExperimental = (warning: string | Error, rest: unknown[]): boolean => {
  const first = rest[0];
  const type = warning instanceof Error
    ? warning.name
    : typeof first === 'string' ? first : (first as { type?: string } | undefined)?.type;
  const message = warning instanceof Error ? warning.message : String(warning);
  return type === 'ExperimentalWarning' && message.includes('SQLite');
};

export function wrapEmitWarning(emit: Emit): Emit {
  return ((warning: string | Error, ...rest: unknown[]) => {
    if (isSqliteExperimental(warning, rest)) return;
    return (emit as (...a: unknown[]) => void).call(process, warning, ...rest);
  }) as Emit;
}

process.emitWarning = wrapEmitWarning(process.emitWarning);
