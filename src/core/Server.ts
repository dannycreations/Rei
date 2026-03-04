import { HttpRouter } from '@effect/platform';

import { anthropicRouter } from '../api/anthropic/Router.js';
import { openAIRouter } from '../api/openai/Router.js';

export const server = HttpRouter.empty.pipe(HttpRouter.mount('/openai', openAIRouter), HttpRouter.mount('/anthropic', anthropicRouter));
