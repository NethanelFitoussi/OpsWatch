/** Every AWS call OpsWatch makes on a user's behalf gives up after this long. */
export const AWS_CALL_TIMEOUT_MS = 5000;

export function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, timeoutMs: number = AWS_CALL_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(Object.assign(new Error(`Timed out after ${timeoutMs} ms`), { name: 'TimeoutError' }));
    }, timeoutMs);
  });
  return Promise.race([run(controller.signal), timeout]).finally(() => clearTimeout(timer));
}
