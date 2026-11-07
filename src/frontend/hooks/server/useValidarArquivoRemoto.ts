import * as React from 'react';

import {normalizeRemoteArchiveUrl} from '../../utils/normalizeRemoteArchiveUrl';

// #142: live validation of a remote-archive URL as the user types. The screen
// used to validate FORMAT only (`normalizeRemoteArchiveUrl`) with no positive
// state and never reached the server — so a valid URL was only "confirmed"
// after a blur/focus round-trip. This hook debounces the typing, hits the
// archive's `/info` endpoint, and exposes an explicit positive state so the
// create button can unlock the instant the server answers.

/**
 * The validation lifecycle for a single typed URL:
 * - `vazio`: nothing typed (or only whitespace).
 * - `formato-invalido`: the string is not a normalizable HTTPS archive URL —
 *   no network call is made.
 * - `verificando`: the format is valid and the `/info` request is in flight.
 * - `valido`: the server returned 200 with a string `data.name`.
 * - `invalido`: any non-200, malformed body, network error, or 8 s timeout.
 */
export type EstadoValidacaoArquivo =
  'vazio' | 'formato-invalido' | 'verificando' | 'valido' | 'invalido';

export type ValidacaoArquivoRemoto = {
  estado: EstadoValidacaoArquivo;
  /** The archive name reported by the server; only set in the `valido` state. */
  nome?: string;
  /** The normalized URL the result belongs to; set once the format is valid. */
  urlNormalizada?: string;
};

// The debounce window (SPEC #142): a new keystroke cancels the pending timer,
// so only the final URL of a burst is ever requested.
const DEBOUNCE_MS = 600;
// The per-request ceiling: a server that never answers must resolve to
// `invalido`, never hang the spinner forever.
const TIMEOUT_MS = 8000;

function normalizarOuNulo(url: string): string | null {
  if (!url.trim()) return null;
  try {
    return normalizeRemoteArchiveUrl(url);
  } catch {
    return null;
  }
}

/**
 * Validates a remote-archive URL live. Returns the current `{estado, nome?,
 * urlNormalizada?}` for the URL passed in. Each distinct URL is a fresh check
 * — no result is reused across URLs — and a late answer for a URL the user has
 * since changed away from can never overwrite the current state.
 */
export function useValidarArquivoRemoto(url: string): ValidacaoArquivoRemoto {
  const urlNormalizada = React.useMemo(() => normalizarOuNulo(url), [url]);
  const vazio = url.trim().length === 0;

  // Only the SETTLED network outcome lives in state — keyed by the URL it
  // belongs to. The synchronous states (vazio/formato-invalido/verificando)
  // are derived during render, so the effect never calls setState
  // synchronously (it only applies the async fetch result, after the await).
  const [resultadoRede, setResultadoRede] =
    React.useState<ValidacaoArquivoRemoto | null>(null);

  React.useEffect(() => {
    // No network work for the synchronous states; the derived value below
    // already reflects them regardless of any previously settled result.
    if (vazio || urlNormalizada === null) {
      return;
    }

    const controller = new AbortController();
    // The stale-response guard: the response is applied only while this effect
    // run is still the current one. A new URL re-runs the effect, flips
    // `cancelado`, and aborts the in-flight request — so a late answer for an
    // old URL can neither land nor race the new state.
    let cancelado = false;

    const timeoutId = setTimeout(() => {
      controller.abort();
    }, TIMEOUT_MS);

    const debounceId = setTimeout(() => {
      const infoUrl = new URL('/info', urlNormalizada).toString();
      fetch(infoUrl, {signal: controller.signal})
        .then(async response => {
          if (response.status !== 200) {
            throw new Error('status');
          }
          const corpo: unknown = await response.json();
          const nome =
            corpo &&
            typeof corpo === 'object' &&
            'data' in corpo &&
            (corpo as {data?: unknown}).data &&
            typeof (corpo as {data?: unknown}).data === 'object' &&
            'name' in (corpo as {data: object}).data &&
            typeof (corpo as {data: {name?: unknown}}).data.name === 'string'
              ? (corpo as {data: {name: string}}).data.name
              : null;
          if (nome === null) {
            throw new Error('body');
          }
          if (cancelado) return;
          setResultadoRede({estado: 'valido', nome, urlNormalizada});
        })
        .catch(() => {
          if (cancelado) return;
          setResultadoRede({estado: 'invalido', urlNormalizada});
        })
        .finally(() => {
          clearTimeout(timeoutId);
        });
    }, DEBOUNCE_MS);

    return () => {
      cancelado = true;
      clearTimeout(debounceId);
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [vazio, urlNormalizada]);

  // Derive the reported state. The settled network result only applies while
  // it still matches the current normalized URL (a second guard against a
  // stale render); otherwise the URL is still being verified.
  if (vazio) return {estado: 'vazio'};
  if (urlNormalizada === null) return {estado: 'formato-invalido'};
  if (resultadoRede && resultadoRede.urlNormalizada === urlNormalizada) {
    return resultadoRede;
  }
  return {estado: 'verificando', urlNormalizada};
}
