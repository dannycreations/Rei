import { HttpRouter, HttpServerRequest, HttpServerResponse } from '@effect/platform';
import { Effect } from 'effect';

import { ProviderRegistry } from '../../core/Provider.js';
import { internalToResponse, OpenAIRequest, requestToInternal } from './Handler.js';

export const openAIRouter = HttpRouter.empty.pipe(
  HttpRouter.post(
    '/v1/chat/completions',
    Effect.gen(function* () {
      const registry = yield* ProviderRegistry;
      const body = yield* HttpServerRequest.schemaBodyJson(OpenAIRequest);

      const mappedModel = registry.mapModel(body.model);
      const provider = yield* registry.getProvider(mappedModel);
      const internalRequest = { ...requestToInternal(body), model: mappedModel };
      const response = yield* provider.execute(internalRequest);

      return yield* HttpServerResponse.json(internalToResponse(response));
    }),
  ),
);
