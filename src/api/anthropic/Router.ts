import { HttpRouter, HttpServerRequest } from '@effect/platform';
import { Effect } from 'effect';

import { Dispatcher } from '../../core/Server.js';
import { AnthropicHandler, AnthropicRequest } from './Handler.js';

export const anthropicRouter = HttpRouter.empty.pipe(
  HttpRouter.post(
    '/v1/messages',
    Effect.gen(function* () {
      const dispatcher = yield* Dispatcher;
      const body = yield* HttpServerRequest.schemaBodyJson(AnthropicRequest);
      return yield* dispatcher.dispatch(body, AnthropicHandler);
    }).pipe(Effect.flatten),
  ),
);
