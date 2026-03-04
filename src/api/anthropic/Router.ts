import { HttpRouter, HttpServerRequest, HttpServerResponse } from '@effect/platform';
import { Effect } from 'effect';

import { ProviderRegistry } from '../../core/Provider.js';
import { AnthropicRequest, internalToResponse, requestToInternal } from './Handler.js';

export const anthropicRouter = HttpRouter.empty.pipe(
  HttpRouter.post(
    '/v1/messages',
    Effect.gen(function* () {
      const registry = yield* ProviderRegistry;
      const body = yield* HttpServerRequest.schemaBodyJson(AnthropicRequest);

      const mappedModel = registry.mapModel(body.model);
      const provider = yield* registry.getProvider(mappedModel);
      const internalRequest = { ...requestToInternal(body), model: mappedModel };
      const response = yield* provider.execute(internalRequest);

      return yield* HttpServerResponse.json(internalToResponse(response));
    }),
  ),
);
