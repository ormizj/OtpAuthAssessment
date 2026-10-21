import { Injectable } from '@nestjs/common';

/**
 * In-process mutex keyed by string: tasks with the same key run one after another, tasks with
 * different keys run concurrently.
 *
 * Used to make read-modify-write sequences on a phone number atomic (e.g. counting OTP attempts),
 * which the database alone cannot do. Only valid within a single process; a multi-instance
 * deployment needs a distributed lock (e.g. Redis) instead.
 */
@Injectable()
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<unknown>>();

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const current = previous.then(task, task);
    // The chain must not reject, or the next task for this key would see that error.
    const tail = current.catch(() => undefined);
    this.tails.set(key, tail);
    try {
      return await current;
    } finally {
      // Drop the entry once no newer task queued behind us, so the map does not grow unbounded.
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}
