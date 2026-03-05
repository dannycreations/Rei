import { HttpMiddleware, HttpRouter, HttpServerRequest, HttpServerResponse } from '@effect/platform';
import { Effect, Option, Stream } from 'effect';

import { anthropicRouter } from '../api/anthropic/Router.js';
import { openAIRouter } from '../api/openai/Router.js';
import { isLocalhost } from '../helpers/Server.js';
import { ConfigTag } from './Config.js';
import { ProviderRegistry } from './Provider.js';
import { InternalRequest, InternalResponse, InternalStreamChunk } from './Schema.js';

export interface ApiHandler<R, T> {
  readonly requestToInternal: (req: R) => InternalRequest;
  readonly internalToResponse: (res: InternalResponse) => T;
  readonly internalToStreamChunk: (chunk: InternalStreamChunk) => unknown;
}

export const Dispatcher = Effect.gen(function* () {
  const registry = yield* ProviderRegistry;

  return {
    models: () =>
      Effect.gen(function* () {
        const models = yield* registry.getModels();
        return yield* HttpServerResponse.json({
          object: 'list',
          data: models.map((m) => ({
            id: m.id,
            object: 'model',
            created: 1704067200,
            owned_by: m.provider,
          })),
        });
      }).pipe(
        Effect.catchAll((error) =>
          Effect.succeed(
            HttpServerResponse.isServerResponse(error)
              ? error
              : HttpServerResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 }),
          ),
        ),
      ),
    dispatch: <R, T>(body: R, handler: ApiHandler<R, T>) =>
      Effect.gen(function* () {
        const internalReq = handler.requestToInternal(body);
        const mapping = registry.mapModel(internalReq.model);
        const provider = yield* registry.getProvider(mapping.with ?? mapping.to);

        const request = { ...internalReq, model: mapping.to };

        if (request.stream) {
          const stream = provider.stream(request);
          const encodedStream = stream.pipe(
            Stream.map((chunk) => {
              const mapped = handler.internalToStreamChunk(chunk);
              return `data: ${JSON.stringify(mapped)}\n\n`;
            }),
            Stream.concat(Stream.make('data: [DONE]\n\n')),
            Stream.encodeText,
            Stream.orDie,
          ) as Stream.Stream<Uint8Array, never, never>;

          return HttpServerResponse.stream(encodedStream, {
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
            },
          });
        }

        const response = yield* provider.generate(request);
        return HttpServerResponse.json(handler.internalToResponse(response));
      }).pipe(
        Effect.catchAll((error) =>
          Effect.succeed(
            HttpServerResponse.isServerResponse(error)
              ? error
              : HttpServerResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 }),
          ),
        ),
      ),
  };
});

export const server = HttpRouter.empty.pipe(
  HttpRouter.use(
    HttpMiddleware.make((httpApp) =>
      Effect.gen(function* () {
        const config = yield* ConfigTag;
        const authKeys = new Set(config['auth-keys']);
        const request = yield* HttpServerRequest.HttpServerRequest;
        const remoteAddress = Option.getOrElse(request.remoteAddress, () => '');

        // If it's localhost, we allow it to be without bearer token
        if (isLocalhost(remoteAddress)) {
          return yield* httpApp;
        }

        // If not localhost, we force authentication
        const authHeader = request.headers['authorization'];
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return yield* HttpServerResponse.json({ error: 'Unauthorized: Missing or invalid Bearer token' }, { status: 401 });
        }

        if (!authKeys.has(authHeader.substring(7))) {
          return yield* HttpServerResponse.json({ error: 'Unauthorized: Invalid auth key' }, { status: 401 });
        }

        return yield* httpApp;
      }),
    ),
  ),
  HttpRouter.concat(openAIRouter),
  HttpRouter.concat(anthropicRouter),
  HttpRouter.get('/v1/models', Effect.flatMap(Dispatcher, (d) => d.models()).pipe(Effect.flatten)),
  HttpRouter.all('*', HttpServerResponse.empty()),
);
