import { HttpRouter, HttpServerRequest } from '@effect/platform';
import { Effect } from 'effect';

import { Dispatcher } from '../../core/Server.js';
import { OpenAIHandler, OpenAIRequest } from './Handler.js';

export const openAIRouter = HttpRouter.empty.pipe(
  HttpRouter.post(
    '/v1/chat/completions',
    Effect.gen(function* () {
      const dispatcher = yield* Dispatcher;
      const body = yield* HttpServerRequest.schemaBodyJson(OpenAIRequest);
      return yield* dispatcher.dispatch(body, OpenAIHandler);
    }).pipe(Effect.flatten),
  ),
);
