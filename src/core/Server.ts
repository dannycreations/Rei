import { HttpMiddleware, HttpRouter, HttpServerRequest, HttpServerResponse } from '@effect/platform';
import { Effect, Option, Stream } from 'effect';

import { anthropicRouter } from '../api/anthropic/Router.js';
import { openAIRouter } from '../api/openai/Router.js';
import { ProviderRegistry } from '../core/Provider.js';
import { InternalRequest, InternalResponse, InternalStreamChunk } from '../core/Schema.js';
import { isLocalhost } from '../helpers/Server.js';
import { ConfigTag } from './Config.js';

export const server = HttpRouter.empty.pipe(
  HttpRouter.mount('/openai', openAIRouter),
  HttpRouter.mount('/anthropic', anthropicRouter),
  HttpRouter.use(
    HttpMiddleware.make((httpApp) =>
      Effect.gen(function* () {
        const config = yield* ConfigTag;
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

        if (!config['auth-keys'].includes(authHeader.substring(7))) {
          return yield* HttpServerResponse.json({ error: 'Unauthorized: Invalid auth key' }, { status: 401 });
        }

        return yield* httpApp;
      }),
    ),
  ),
);

export interface ApiHandler<R, T> {
  readonly requestToInternal: (req: R) => InternalRequest;
  readonly internalToResponse: (res: InternalResponse) => T;
  readonly internalToStreamChunk: (chunk: InternalStreamChunk) => unknown;
}

export const Dispatcher = Effect.gen(function* () {
  const registry = yield* ProviderRegistry;

  return {
    dispatch: <R, T>(body: R, handler: ApiHandler<R, T>) =>
      Effect.flatMap(
        Effect.gen(function* () {
          const internalReq = handler.requestToInternal(body);
          const mapping = registry.mapModel(internalReq.model);
          const provider = yield* registry.getProvider(mapping.with ?? mapping.to);

          const request = { ...internalReq, model: mapping.to };

          if (request.stream) {
            const stream = provider.stream(request);
            return HttpServerResponse.stream(
              stream.pipe(
                Stream.map((chunk) => {
                  const mapped = handler.internalToStreamChunk(chunk);
                  return `data: ${JSON.stringify(mapped)}\n\n`;
                }),
                Stream.concat(Stream.make('data: [DONE]\n\n')),
                Stream.encodeText,
              ),
              {
                headers: {
                  'Content-Type': 'text/event-stream',
                  'Cache-Control': 'no-cache',
                  Connection: 'keep-alive',
                },
              },
            );
          }

          const response = yield* provider.generate(request);
          return HttpServerResponse.json(handler.internalToResponse(response));
        }),
        (res) => Effect.succeed(res),
      ) as Effect.Effect<HttpServerResponse.HttpServerResponse, Error, never>,
  };
});
