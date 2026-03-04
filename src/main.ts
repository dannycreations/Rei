import { createServer } from 'node:http';
import { Command, Options } from '@effect/cli';
import { HttpMiddleware, HttpServer } from '@effect/platform';
import { NodeContext, NodeHttpClient, NodeHttpServer, NodeRuntime } from '@effect/platform-node';
import { Effect, Layer, Option } from 'effect';

import { AuthLive } from './core/Auth.js';
import { ConfigLive } from './core/Config.js';
import { ProviderRegistryLive } from './core/Provider.js';
import { server } from './core/Server.js';

const options = Options.all({
  config: Options.text('config').pipe(Options.withDescription('Path to yaml config file'), Options.optional),
  auth: Options.text('auth').pipe(Options.withDescription('Path to auth file'), Options.repeated),
  auth_dir: Options.text('auth_dir').pipe(Options.withDescription('Directory containing auth files'), Options.repeated),
});

const run = (args: {
  readonly options: {
    readonly config: Option.Option<string>;
    readonly auth: ReadonlyArray<string>;
    readonly auth_dir: ReadonlyArray<string>;
  };
}) =>
  Effect.gen(function* () {
    const configPath = Option.getOrUndefined(args.options.config);
    const HttpLive = server.pipe(
      HttpServer.serve(HttpMiddleware.logger),
      HttpServer.withLogAddress,
      Layer.provide(NodeHttpServer.layer(() => createServer(), { port: 3000 })),
      Layer.provide(ProviderRegistryLive),
      Layer.provide(NodeHttpClient.layer),
      Layer.provide(ConfigLive(configPath)),
      Layer.provide(AuthLive(args.options.auth, args.options.auth_dir)),
    );

    yield* Layer.launch(HttpLive).pipe(Effect.provide(NodeContext.layer));
  });

const command = Command.make('rei', { options }, run);

const cli = Command.run(command, {
  name: 'Rei Proxies',
  version: '1.0.0',
});

NodeRuntime.runMain(
  cli(process.argv).pipe(
    Effect.provide(ConfigLive()),
    Effect.provide(NodeContext.layer),
    Effect.catchAllCause((cause) => Effect.logError(cause)),
  ),
);
