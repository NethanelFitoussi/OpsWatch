import type { GetOutputType } from '@smithy/types';

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

type AbortableClient<C> = { send(command: C, options: { abortSignal: AbortSignal }): Promise<GetOutputType<C>> };

/** Sends one AWS SDK command, aborting it and rejecting with a `TimeoutError` after `timeoutMs`. */
export function sendWithTimeout<C extends { readonly input: object }>(
  client: AbortableClient<NoInfer<C>>,
  command: C,
  timeoutMs: number = AWS_CALL_TIMEOUT_MS,
): Promise<GetOutputType<C>> {
  return withTimeout((abortSignal) => client.send(command, { abortSignal }), timeoutMs);
}
