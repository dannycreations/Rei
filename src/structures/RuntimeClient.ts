import { Effect, Fiber, Ref, Runtime, Schedule } from 'effect';

export interface RuntimeBridge {
  readonly runFork: <A, E, R>(effect: Effect.Effect<A, E, R>, options?: { readonly name?: string }) => Fiber.RuntimeFiber<A | void, never>;
  readonly runSync: <A, E, R>(effect: Effect.Effect<A, E, R>) => A;
  readonly runPromise: <A, E, R>(effect: Effect.Effect<A, E, R>) => Promise<A>;
}

export const makeRuntimeBridge = Effect.gen(function* () {
  const runtime = yield* Effect.runtime<unknown>();
  const runFork = Runtime.runFork(runtime);
  const runSync = Runtime.runSync(runtime);
  const runPromise = Runtime.runPromise(runtime);

  return {
    runFork: (effect, options) =>
      runFork(
        effect.pipe(
          Effect.sandbox,
          Effect.catchAll((cause) => Effect.logError(`Unhandled error in forked bridge${options?.name ? ` [${options.name}]` : ''}`, cause)),
        ),
      ),
    runSync: (effect) => runSync(effect),
    runPromise: (effect) => runPromise(effect),
  } satisfies RuntimeBridge;
});

export interface RuntimeCycleOptions {
  readonly maxRestarts?: number;
  readonly intervalMs?: number;
  readonly restartDelayMs?: number;
}

export const runMainCycle = <A, E, R>(program: Effect.Effect<A, E, R>, options: RuntimeCycleOptions = {}): void => {
  const { maxRestarts = 3, intervalMs = 60_000, restartDelayMs = 5_000 } = options;

  const mainEffect = Effect.gen(function* () {
    const { runFork, runPromise } = yield* makeRuntimeBridge;

    const restartTimesRef = yield* Ref.make<readonly number[]>([]);

    const cycle = program.pipe(
      Effect.scoped,
      Effect.sandbox,
      Effect.catchAll((cause) =>
        Effect.gen(function* () {
          const now = yield* Effect.sync(() => Date.now());
          const restartTimes = yield* Ref.get(restartTimesRef);
          const nextRestarts = [...restartTimes.filter((t) => now - t < intervalMs), now];

          yield* Ref.set(restartTimesRef, nextRestarts);

          if (nextRestarts.length >= maxRestarts) {
            yield* Effect.logFatal('System crashed too many times. Shutting down...', cause);
            yield* Effect.sync(() => process.exit(1));
          }

          yield* Effect.logError('System encountered an error', cause);
          yield* Effect.logInfo(`System restarting in ${restartDelayMs / 1000} seconds...`);
          yield* Effect.sleep(`${restartDelayMs} millis`);
        }),
      ),
      Effect.repeat(Schedule.forever),
      Effect.ignore,
    );

    const fiber = runFork(cycle, { name: 'MainCycle' });

    const cleanUp = () => {
      process.removeAllListeners('SIGINT');
      process.removeAllListeners('SIGTERM');
      runPromise(Fiber.interrupt(fiber))
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
    };

    process.once('SIGINT', cleanUp);
    process.once('SIGTERM', cleanUp);
  }) as Effect.Effect<never, never, never>;

  Effect.runFork(mainEffect);
};
