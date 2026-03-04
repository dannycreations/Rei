import { HttpRouter, HttpServerRequest, HttpServerResponse } from '@effect/platform';
import { Effect } from 'effect';

import { ProviderRegistry } from '../../core/Provider.js';
import { AnthropicRequest, internalToResponse, requestToInternal } from './Handler.js';

export const anthropicRouter = HttpRouter.empty.pipe(
  HttpRouter.post(
    '/v1/messages',
    Effect.gen(function* (_) {
      const registry = yield* _(ProviderRegistry);
      const body = yield* _(HttpServerRequest.schemaBodyJson(AnthropicRequest));

      const provider = yield* _(registry.getProvider(body.model));
      const internalRequest = requestToInternal(body);
      const response = yield* _(provider.execute(internalRequest));

      return yield* _(HttpServerResponse.json(internalToResponse(response)));
    }),
  ),
);
