import { createServer } from 'node:http';
import { Command, Options } from '@effect/cli';
import { HttpMiddleware, HttpServer } from '@effect/platform';
import { NodeContext, NodeHttpClient, NodeHttpServer } from '@effect/platform-node';
import { Cause, Effect, Layer, Logger, Option } from 'effect';

import { AuthLive } from './core/Auth.js';
import { ConfigLive } from './core/Config.js';
import { ProviderRegistryLive } from './core/Provider.js';
import { server } from './core/Server.js';
import { LoggerClientLayer, makeLoggerClient } from './structures/LoggerClient.js';
import { runMainCycle } from './structures/RuntimeClient.js';

const run = (args: {
  readonly options: {
    readonly port: number;
    readonly config: Option.Option<string>;
    readonly auth: ReadonlyArray<string>;
    readonly auth_dir: ReadonlyArray<string>;
    readonly log_level: string;
    readonly log_dir: Option.Option<string>;
  };
}) => {
  const logger = makeLoggerClient({
    level: args.options.log_level as never,
    dir: Option.getOrUndefined(args.options.log_dir),
  });

  return Effect.gen(function* () {
    yield* Effect.log('Initializing Rei Proxies');

    const configPath = Option.getOrUndefined(args.options.config);
    yield* Effect.log(`Config path: ${configPath ?? 'none'}`);

    const startServer = (port: number): Effect.Effect<void, never, never> =>
      Effect.gen(function* () {
        yield* Effect.log(`Attempting to start server on port ${port}`);

        const layer = server.pipe(
          HttpServer.serve(HttpMiddleware.make((app) => app)),
          Layer.provide(NodeHttpServer.layer(() => createServer(), { port })),
          Layer.provide(ProviderRegistryLive),
          Layer.provide(NodeHttpClient.layer),
          Layer.provide(AuthLive(args.options.auth, args.options.auth_dir)),
        );

        yield* Effect.log(`Listening on http://localhost:${port}`);
        yield* Layer.launch(layer).pipe(Effect.provide(ConfigLive(configPath)), Effect.provide(NodeContext.layer));
      }).pipe(
        Effect.catchAllCause((cause) =>
          Effect.gen(function* () {
            yield* Effect.log('Server failed with cause');
            const error = Cause.failureOption(cause).pipe(
              Option.filter((error) => {
                const e = error as { _tag?: string; reason?: string };
                return e?._tag === 'SystemError' && e?.reason === 'EADDRINUSE';
              }),
            );

            if (Option.isSome(error)) {
              yield* Effect.log(`Port ${port} in use, retrying on ${port + 1}`);
              return yield* startServer(port + 1);
            }

            yield* Effect.log('Non-recoverable error encountered');
            return yield* Effect.failCause(cause).pipe(Effect.logError);
          }),
        ),
      );

    yield* Effect.log('Application setup complete, launching server');
    yield* startServer(args.options.port);
  }).pipe(Effect.provide(LoggerClientLayer(Logger.defaultLogger, logger)));
};

const options = Options.all({
  config: Options.text('config').pipe(Options.withDescription('Path to yaml config file'), Options.optional),
  auth: Options.text('auth').pipe(Options.withDescription('Path to auth file'), Options.repeated),
  auth_dir: Options.text('auth_dir').pipe(Options.withDescription('Directory containing auth files'), Options.repeated),
  port: Options.integer('port').pipe(Options.withDescription('Port to listen on'), Options.withDefault(1490)),
  log_level: Options.text('log_level').pipe(Options.withDescription('Log level'), Options.withDefault('info')),
  log_dir: Options.text('log_dir').pipe(Options.withDescription('Log directory'), Options.optional),
});

const command = Command.make('rei', { options }, run);

const cli = Command.run(command, {
  name: 'Rei Proxies',
  version: '1.0.0',
});

runMainCycle(cli(process.argv).pipe(Effect.provide(NodeContext.layer)));
