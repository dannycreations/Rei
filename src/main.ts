import { createServer } from 'node:http';
import { HttpMiddleware, HttpServer } from '@effect/platform';
import { NodeHttpClient, NodeHttpServer, NodeRuntime } from '@effect/platform-node';
import { Layer } from 'effect';

import { ConfigLive } from './core/Config.js';
import { ProviderRegistryLive } from './core/Provider.js';
import { server } from './core/Server.js';

const HttpLive = server.pipe(
  HttpServer.serve(HttpMiddleware.logger),
  HttpServer.withLogAddress,
  Layer.provide(NodeHttpServer.layer(() => createServer(), { port: 3000 })),
  Layer.provide(ProviderRegistryLive),
  Layer.provide(NodeHttpClient.layer),
  Layer.provide(ConfigLive),
);

NodeRuntime.runMain(Layer.launch(HttpLive));
