import { delayFor, retryable } from './outbox.ts';

/** Attempts for one idempotent new-topic request (first try plus retries). */
export const NEW_TOPIC_ATTEMPTS = 4;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Run one idempotent request and retry only temporary failures (network, timeout,
 * 408/425/429/5xx) with the outbox backoff. A stale connection after resume often
 * fails the first request; the user must not see an error for that. Stops when
 * the caller is gone. Never use for steps that are unsafe to repeat.
 */
export async function retryStep<T>(step: () => Promise<T>, alive: () => boolean,
  wait: (ms: number) => Promise<void> = sleep, attempts = NEW_TOPIC_ATTEMPTS): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try { return await step(); }
    catch (error) {
      if (attempt >= attempts || !retryable(error) || !alive()) throw error;
      await wait(delayFor(attempt, error));
      if (!alive()) throw error;
    }
  }
}
