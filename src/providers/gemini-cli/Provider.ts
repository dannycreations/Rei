import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { FileSystem, HttpClient, HttpClientRequest } from '@effect/platform';
import { Effect, Option, Schema, Stream } from 'effect';

import { Auth, AuthTag } from '../../core/Auth.js';
import { Provider } from '../../core/Provider.js';
import { InternalRequest, InternalResponse, InternalStreamChunk } from '../../core/Schema.js';
import { streamSSE } from '../../helpers/Server.js';

import type { AuthSession } from '../../core/Auth.js';

const CODE_ASSIST_ENDPOINT = 'https://cloudcode-pa.googleapis.com/v1internal';
const OAUTH_CLIENT_ID = '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com';
const OAUTH_CLIENT_SECRET = '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';
const OAUTH_DEFAULT_PATH = join(homedir(), '.gemini', 'oauth_creds.json');

export const OAuthCredentials = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.String,
  token_type: Schema.String,
  expiry_date: Schema.Number,
  project_id: Schema.optional(Schema.String),
});

export type OAuthCredentials = Schema.Schema.Type<typeof OAuthCredentials>;

const mapRequest = (request: InternalRequest) => {
  const systemInstruction = request.system
    ? {
        role: 'user',
        parts: [{ text: request.system }],
      }
    : undefined;

  const contents = request.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts:
        typeof m.content === 'string'
          ? [{ text: m.content }]
          : m.content.map((c) => {
              if (c.type === 'text') return { text: c.text };
              if (c.type === 'tool_use')
                return {
                  functionCall: {
                    name: c.name,
                    args: c.input,
                  },
                };
              if (c.type === 'tool_result')
                return {
                  functionResponse: {
                    name: c.tool_use_id,
                    response: { result: c.content },
                  },
                };
              return { text: `[Image: ${c.image}]` };
            }),
    }));

  const tools = request.tools
    ? [
        {
          functionDeclarations: request.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parametersJsonSchema: t.input_schema,
          })),
        },
      ]
    : undefined;

  return {
    contents,
    systemInstruction,
    tools,
    toolConfig: request.toolChoice
      ? {
          functionCallingConfig: {
            mode: request.toolChoice === 'auto' ? 'AUTO' : request.toolChoice === 'any' ? 'ANY' : request.toolChoice === 'none' ? 'NONE' : 'ANY',
            allowedFunctionNames: typeof request.toolChoice !== 'string' ? [request.toolChoice.name] : undefined,
          },
        }
      : undefined,
    generationConfig: {
      temperature: request.temperature,
      maxOutputTokens: request.maxTokens,
      topP: request.topP,
      stopSequences: request.stop,
    },
  };
};

const ensureProjectId = (session: AuthSession<OAuthCredentials>): Effect.Effect<string, Error, HttpClient.HttpClient | FileSystem.FileSystem> =>
  Effect.gen(function* () {
    if (session.data.project_id) return session.data.project_id;

    const fs = yield* FileSystem.FileSystem;
    const envContent = yield* fs.readFileString(join(dirname(OAUTH_DEFAULT_PATH), '.env')).pipe(
      Effect.map(Option.some),
      Effect.catchAll(() => Effect.succeed(Option.none())),
    );

    if (Option.isSome(envContent)) {
      const match = envContent.value.match(/GOOGLE_CLOUD_PROJECT=[\"']?([^\"'\\r\\n\\s;]+)[\"']?/);
      if (match) {
        const id = match[1].trim();
        yield* session.save({ ...session.data, project_id: id });
        return id;
      }
    }

    const client = yield* HttpClient.HttpClient;
    const loadReq = HttpClientRequest.post(`${CODE_ASSIST_ENDPOINT}:loadCodeAssist`).pipe(
      HttpClientRequest.setHeader('Authorization', `Bearer ${session.data.access_token}`),
      HttpClientRequest.bodyJson({
        metadata: {
          ideType: 'IDE_UNSPECIFIED',
          platform: 'PLATFORM_UNSPECIFIED',
          pluginType: 'GEMINI',
        },
      }),
    );

    const loadRes = yield* Effect.flatMap(loadReq, (r) => client.execute(r));
    const loadJson = (yield* loadRes.json) as {
      cloudaicompanionProject?: string;
      allowedTiers?: Array<{ id: string; isDefault?: boolean }>;
    };

    let projectId = loadJson.cloudaicompanionProject;

    if (!projectId) {
      const tierId = loadJson.allowedTiers?.find((t) => t.id === 'free-tier' || t.isDefault)?.id || 'free-tier';
      const onboardReq = HttpClientRequest.post(`${CODE_ASSIST_ENDPOINT}:onboardUser`).pipe(
        HttpClientRequest.setHeader('Authorization', `Bearer ${session.data.access_token}`),
        HttpClientRequest.bodyJson({
          tierId,
          metadata: {
            ideType: 'IDE_UNSPECIFIED',
            platform: 'PLATFORM_UNSPECIFIED',
            pluginType: 'GEMINI',
          },
        }),
      );

      const onboardRes = yield* Effect.flatMap(onboardReq, (r) => client.execute(r));
      const onboardJson = (yield* onboardRes.json) as {
        response?: { cloudaicompanionProject?: { id?: string } };
      };
      projectId = onboardJson.response?.cloudaicompanionProject?.id;
    }

    if (!projectId) {
      return yield* Effect.fail(
        new Error(
          'Failed to determine Google Cloud Project ID for Gemini CLI. Please set GOOGLE_CLOUD_PROJECT in .env or ensure your account is onboarded.',
        ),
      );
    }

    yield* session.save({ ...session.data, project_id: projectId });
    return projectId;
  }).pipe(Effect.catchAll((e) => Effect.fail(new Error(String(e)))));

const ensureAuthenticated = (): Effect.Effect<
  { session: AuthSession<OAuthCredentials>; credentials: OAuthCredentials },
  Error,
  HttpClient.HttpClient | Auth | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const auth = yield* AuthTag;
    const fs = yield* FileSystem.FileSystem;
    const session = yield* auth.next('gemini-cli', OAuthCredentials).pipe(
      Effect.catchAll(() =>
        Effect.gen(function* () {
          let oauthPath: string = '';
          const envContent = yield* fs.readFileString(join(dirname(OAUTH_DEFAULT_PATH), '.env')).pipe(
            Effect.map((s) => s as string | undefined),
            Effect.catchAll(() => Effect.succeed(undefined)),
          );
          if (envContent !== undefined) {
            const match = envContent.match(/GOOGLE_OAUTH_PATH=[\"']?([^\"'\\r\\n\\s]+)[\"']?/);
            if (match) oauthPath = match[1].trim();
          }
          const credPath = oauthPath || OAUTH_DEFAULT_PATH;
          return yield* auth.load('gemini-cli', credPath, OAuthCredentials);
        }),
      ),
    );

    let credentials = session.data;

    if (credentials.expiry_date - 60_000 < Date.now()) {
      const client = yield* HttpClient.HttpClient;
      const refreshReq = HttpClientRequest.post('https://oauth2.googleapis.com/token').pipe(
        HttpClientRequest.bodyJson({
          client_id: OAUTH_CLIENT_ID,
          client_secret: OAUTH_CLIENT_SECRET,
          refresh_token: credentials.refresh_token,
          grant_type: 'refresh_token',
        }),
      );
      const res = yield* Effect.flatMap(refreshReq, (r) => client.execute(r));
      const json = (yield* res.json) as {
        access_token: string;
        refresh_token?: string;
        token_type?: string;
        expires_in?: number;
      };

      credentials = {
        ...credentials,
        access_token: json.access_token,
        refresh_token: json.refresh_token || credentials.refresh_token,
        token_type: json.token_type || 'Bearer',
        expiry_date: Date.now() + (json.expires_in || 3600) * 1000,
      };

      yield* session.save(credentials);
    }

    return { session, credentials };
  }).pipe(Effect.catchAll((e) => Effect.fail(new Error(String(e)))));

export const GeminiCliProvider: Provider = {
  id: 'gemini-cli',
  name: 'Gemini CLI',
  models: [
    'gemini-3.1-pro-preview',
    'gemini-3.1-flash-lite-preview',
    'gemini-3-pro-preview',
    'gemini-3-flash-preview',
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
  ],

  generate: (request: InternalRequest) =>
    Effect.gen(function* () {
      const { session, credentials } = yield* ensureAuthenticated();
      const projectId = yield* ensureProjectId(session);

      const body = mapRequest(request);
      const req = HttpClientRequest.post(`${CODE_ASSIST_ENDPOINT}:generateContent`).pipe(
        HttpClientRequest.setHeader('Authorization', `Bearer ${credentials.access_token}`),
        HttpClientRequest.bodyJson({
          model: request.model,
          project: projectId,
          request: body,
        }),
      );

      const client = yield* HttpClient.HttpClient;
      const res = yield* Effect.flatMap(req, (r) => client.execute(r));
      type GeminiResponse = {
        response?: {
          candidates?: Array<{
            content?: {
              parts?: Array<{
                text?: string;
                thought?: boolean;
                functionCall?: {
                  name: string;
                  args: any;
                };
              }>;
            };
          }>;
          usageMetadata?: {
            promptTokenCount?: number;
            candidatesTokenCount?: number;
          };
          responseId?: string;
        };
      };
      const json = (yield* res.json) as GeminiResponse;

      const candidates = json.response?.candidates || [];
      const parts = candidates.flatMap((c) => c.content?.parts || []);
      const content: Array<InternalResponse['content'][number]> = [];

      for (const p of parts) {
        if (p.text && !p.thought) {
          content.push({ type: 'text' as const, text: p.text });
        }
        if (p.functionCall) {
          content.push({
            type: 'tool_use' as const,
            id: `${p.functionCall.name}_${Date.now()}`,
            name: p.functionCall.name,
            input: p.functionCall.args,
          });
        }
      }

      const usage = json.response?.usageMetadata || {};

      return {
        id: json.response?.responseId || Date.now().toString(),
        model: request.model,
        content,
        role: 'assistant' as const,
        usage: {
          promptTokens: usage.promptTokenCount ?? 0,
          completionTokens: usage.candidatesTokenCount ?? 0,
          totalTokens: (usage.promptTokenCount ?? 0) + (usage.candidatesTokenCount ?? 0),
        },
      };
    }).pipe(Effect.catchAll((e) => Effect.fail(new Error(String(e))))),

  stream: (request: InternalRequest) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const { session, credentials } = yield* ensureAuthenticated();
        const projectId = yield* ensureProjectId(session);

        const body = mapRequest(request);
        const req = HttpClientRequest.post(`${CODE_ASSIST_ENDPOINT}:streamGenerateContent`).pipe(
          HttpClientRequest.setHeader('Authorization', `Bearer ${credentials.access_token}`),
          HttpClientRequest.appendUrlParam('alt', 'sse'),
          HttpClientRequest.bodyJson({
            model: request.model,
            project: projectId,
            request: body,
          }),
        );

        const client = yield* HttpClient.HttpClient;
        const res = yield* Effect.flatMap(req, (r) => client.execute(r));

        return streamSSE(res.stream).pipe(
          Stream.flatMap((json) => {
            const j = json as {
              response?: {
                candidates?: Array<{
                  content?: {
                    parts?: Array<{
                      text?: string;
                      functionCall?: {
                        name: string;
                        args: any;
                      };
                    }>;
                  };
                  finishReason?: string | null;
                }>;
                responseId?: string;
              };
            };
            const candidate = j.response?.candidates?.[0];
            const parts = candidate?.content?.parts || [];
            const responseId = j.response?.responseId || '';
            const done = !!candidate?.finishReason;

            const chunks = parts.map((p): InternalStreamChunk => {
              let content: InternalStreamChunk['content'];
              if (p.text) {
                content = { type: 'text_delta' as const, text: p.text };
              } else if (p.functionCall) {
                content = {
                  type: 'tool_use_delta' as const,
                  index: 0,
                  id: `${p.functionCall.name}_${Date.now()}`,
                  name: p.functionCall.name,
                  input: JSON.stringify(p.functionCall.args),
                };
              } else {
                content = { type: 'text_delta' as const, text: '' };
              }
              return {
                id: responseId,
                content,
                done: false,
              };
            });

            if (done) {
              chunks.push({
                id: responseId,
                content: { type: 'text_delta' as const, text: '' },
                done: true,
              });
            }

            return Stream.fromIterable(chunks);
          }),
        );
      }),
    ).pipe(Stream.catchAll((e) => Stream.fail(new Error(String(e))))),
};
