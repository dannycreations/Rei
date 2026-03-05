import { Effect, Option, Stream } from 'effect';

export const isLocalhost = (address: string) =>
  address === 'localhost' || address === '127.0.0.1' || address === '::ffff:127.0.0.1' || address === '::1';

export const streamSSE = (stream: Stream.Stream<Uint8Array, Error, never>) =>
  stream.pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.filterMap((line) => {
      if (!line.startsWith('data: ')) return Option.none();
      const data = line.slice(6).trim();
      return data.length > 0 && data !== '[DONE]' ? Option.some(data) : Option.none();
    }),
    Stream.mapEffect((line) => Effect.try(() => JSON.parse(line))),
  );
