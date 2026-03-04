import { createServer } from 'node:http';
import { Command, Options } from '@effect/cli';
import { HttpMiddleware, HttpServer } from '@effect/platform';
import { NodeContext, NodeHttpClient, NodeHttpServer, NodeRuntime } from '@effect/platform-node';
import { Cause, Effect, Layer, Option } from 'effect';

import { AuthLive } from './core/Auth.js';
import { ConfigLive } from './core/Config.js';
import { ProviderRegistryLive } from './core/Provider.js';
import { server } from './core/Server.js';

const options = Options.all({
  config: Options.text('config').pipe(Options.withDescription('Path to yaml config file'), Options.optional),
  auth: Options.text('auth').pipe(Options.withDescription('Path to auth file'), Options.repeated),
  auth_dir: Options.text('auth_dir').pipe(Options.withDescription('Directory containing auth files'), Options.repeated),
  port: Options.integer('port').pipe(Options.withDescription('Port to listen on'), Options.withDefault(1490)),
});

const run = (args: {
  readonly options: {
    readonly config: Option.Option<string>;
    readonly auth: ReadonlyArray<string>;
    readonly auth_dir: ReadonlyArray<string>;
    readonly port: number;
  };
}) =>
  Effect.gen(function* () {
    const configPath = Option.getOrUndefined(args.options.config);

    const startServer = (port: number): Effect.Effect<void, never, never> =>
      Layer.launch(
        server.pipe(
          HttpServer.serve(HttpMiddleware.logger),
          Layer.provide(NodeHttpServer.layer(() => createServer(), { port })),
          Layer.provide(ProviderRegistryLive),
          Layer.provide(NodeHttpClient.layer),
          Layer.provide(ConfigLive(configPath)),
          Layer.provide(AuthLive(args.options.auth, args.options.auth_dir)),
        ),
      ).pipe(
        Effect.tap(() => Effect.log(`Rei Proxies listening on http://localhost:${port}`)),
        Effect.catchAllCause((cause) => {
          const error = Cause.failureOption(cause).pipe(
            Option.filter((error) => {
              const e = error as any;
              return e?._tag === 'SystemError' && e?.reason === 'EADDRINUSE';
            }),
          );

          if (Option.isSome(error)) {
            return startServer(port + 1);
          }

          return Effect.failCause(cause);
        }),
        Effect.provide(ConfigLive(configPath)),
        Effect.provide(NodeContext.layer),
        Effect.catchAllCause((cause) => Effect.logError(cause)),
      );

    yield* startServer(args.options.port);
  });

const command = Command.make('rei', { options }, run);

const cli = Command.run(command, {
  name: 'Rei Proxies',
  version: '1.0.0',
});

NodeRuntime.runMain(cli(process.argv).pipe(Effect.provide(NodeContext.layer)));
