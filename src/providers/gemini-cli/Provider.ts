import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { FileSystem, HttpClient, HttpClientRequest } from '@effect/platform';
import { Effect, Schema, Stream } from 'effect';

import { Auth, AuthTag } from '../../core/Auth.js';
import { Provider } from '../../core/Provider.js';
import { InternalRequest } from '../../core/Schema.js';

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
    .map((m) => {
      let parts: Array<{ text: string }> = [];
      if (typeof m.content === 'string') {
        parts = [{ text: m.content }];
      } else {
        parts = m.content.map((c) => {
          if (c.type === 'text') return { text: c.text };
          if (c.type === 'image') {
            return { text: `[Image: ${c.image}]` };
          }
          return { text: '' };
        });
      }
      return {
        role: m.role === 'assistant' ? 'model' : 'user',
        parts,
      };
    });

  return {
    contents,
    systemInstruction,
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
    try {
      const envContent = yield* fs.readFileString(join(dirname(OAUTH_DEFAULT_PATH), '.env'));
      const match = envContent.match(/GOOGLE_CLOUD_PROJECT=["']?([^"'\\\r\n\s]+)["']?/);
      if (match) {
        const id = match[1].trim();
        yield* session.save({ ...session.data, project_id: id });
        return id;
      }
    } catch {}

    const client = yield* HttpClient.HttpClient;
    const loadReq = HttpClientRequest.post(`${CODE_ASSIST_ENDPOINT}:loadCodeAssist`).pipe(
      HttpClientRequest.setHeader('Authorization', `Bearer ${session.data.access_token}`),
      HttpClientRequest.bodyJson({
        metadata: { ideType: 'IDE_UNSPECIFIED', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' },
      }),
    );

    const loadRes = yield* Effect.flatMap(loadReq, (r) => client.execute(r));
    const loadJson = (yield* loadRes.json) as {
      cloudaicompanionProject?: string;
      allowedTiers?: Array<{ id: string; isDefault?: boolean }>;
    };

    let projectId = 'dummy-project';

    if (loadJson.cloudaicompanionProject) {
      projectId = loadJson.cloudaicompanionProject;
    } else {
      const tierId = loadJson.allowedTiers?.find((t) => t.id === 'free-tier' || t.isDefault)?.id || 'free-tier';
      const onboardReq = HttpClientRequest.post(`${CODE_ASSIST_ENDPOINT}:onboardUser`).pipe(
        HttpClientRequest.setHeader('Authorization', `Bearer ${session.data.access_token}`),
        HttpClientRequest.bodyJson({
          tierId,
          metadata: { ideType: 'IDE_UNSPECIFIED', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' },
        }),
      );

      const onboardRes = yield* Effect.flatMap(onboardReq, (r) => client.execute(r));
      const onboardJson = (yield* onboardRes.json) as {
        response?: { cloudaicompanionProject?: { id?: string } };
      };
      projectId = onboardJson.response?.cloudaicompanionProject?.id || 'dummy-project';
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
          try {
            const envContent = yield* fs.readFileString(join(dirname(OAUTH_DEFAULT_PATH), '.env'));
            const match = envContent.match(/GOOGLE_OAUTH_PATH=["']?([^"'\\\r\n\s]+)["']?/);
            if (match) oauthPath = match[1].trim();
          } catch {}
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
            content?: { parts?: Array<{ text?: string; thought?: boolean }> };
          }>;
          usageMetadata?: {
            promptTokenCount?: number;
            candidatesTokenCount?: number;
          };
          responseId?: string;
        };
      };
      const json = (yield* res.json) as GeminiResponse;

      const candidate = json.response?.candidates?.[0];
      const content =
        candidate?.content?.parts
          ?.filter((p) => p.text && !p.thought)
          ?.map((p) => p.text)
          ?.join('') || '';

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

        return res.stream.pipe(
          Stream.decodeText(),
          Stream.splitLines,
          Stream.filter((line) => line.startsWith('data: ')),
          Stream.map((line) => line.slice(6).trim()),
          Stream.filter((line) => line.length > 0),
          Stream.mapEffect((line) =>
            Effect.try(
              () =>
                JSON.parse(line) as {
                  response?: {
                    candidates?: Array<{
                      content?: { parts?: Array<{ text?: string }> };
                      finishReason?: string | null;
                    }>;
                    responseId?: string;
                  };
                },
            ),
          ),
          Stream.map((json) => {
            const candidate = json.response?.candidates?.[0];
            const part = candidate?.content?.parts?.[0];
            return {
              id: json.response?.responseId || '',
              content: part?.text || '',
              done: !!candidate?.finishReason,
            };
          }),
        );
      }),
    ).pipe(Stream.catchAll((e) => Stream.fail(new Error(String(e))))),
};
