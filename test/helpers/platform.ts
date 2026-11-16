/**
 * Run fn with process.platform set to the given value.
 * The code under test reads process.platform. A test that names a platform must pin it,
 * or the result depends on the host. The real value comes back when fn ends.
 * Use it for a synchronous fn only. An async fn would restore the platform too early.
 */
export function asPlatform<T>(platform: NodeJS.Platform, fn: () => T): T {
  const saved = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { value: platform });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, 'platform', saved);
  }
}
