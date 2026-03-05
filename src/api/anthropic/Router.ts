import { HttpRouter, HttpServerRequest, HttpServerResponse } from '@effect/platform';
import { Effect } from 'effect';

import { Dispatcher } from '../../core/Server.js';
import { AnthropicCountTokensRequest, AnthropicHandler, AnthropicRequest, ClaudeCountTokensHandler } from './Handler.js';

export const anthropicRouter = HttpRouter.empty.pipe(
  HttpRouter.post(
    '/v1/messages',
    Effect.gen(function* () {
      const dispatcher = yield* Dispatcher;
      const body = yield* HttpServerRequest.schemaBodyJson(AnthropicRequest);
      return yield* dispatcher.dispatch(body, AnthropicHandler);
    }).pipe(Effect.flatten),
  ),
  HttpRouter.post(
    '/v1/messages/count_tokens',
    Effect.gen(function* () {
      const dispatcher = yield* Dispatcher;
      const body = yield* HttpServerRequest.schemaBodyJson(AnthropicCountTokensRequest);
      return yield* dispatcher.dispatch(body, ClaudeCountTokensHandler);
    }).pipe(Effect.flatten),
  ),
  HttpRouter.post('/api/event_logging/batch', HttpServerResponse.json({ status: 'ok' })),
);
