/**
 * Identity of a remote archive server (#142). Core identifies the archive
 * member by `deviceId`; the journal also records the normalized `baseUrl`
 * because `addServerPeer` returns `void` and therefore the device id is not
 * always available when the archive is applied.
 *
 * Both fields are optional so a legacy journal (URL only) keeps working: the
 * journal URL is the fallback identity when the slot has no explicit one.
 */
export type IdentidadeArquivoRemoto = {
  baseUrl?: string;
  deviceId?: string;
};

/** Normalized identity form: trimmed `baseUrl` without the trailing slash. */
export function normalizarBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

/**
 * Fills a missing `baseUrl` from the journal URL and normalizes the result.
 * Returns `undefined` when neither field is usable, meaning "no identity" —
 * callers must then fall back to the legacy "any active archive" behavior.
 */
export function normalizarIdentidade(
  identidade: IdentidadeArquivoRemoto | undefined,
  fallbackBaseUrl?: string,
): IdentidadeArquivoRemoto | undefined {
  if (!identidade) return undefined;
  const bruto = identidade.baseUrl ?? fallbackBaseUrl;
  const baseUrl = bruto ? normalizarBaseUrl(bruto) : undefined;
  const deviceId = identidade.deviceId?.trim() || undefined;
  if (!baseUrl && !deviceId) return undefined;
  return {baseUrl, deviceId};
}

/**
 * Whether a REMOVAL identity names the archive recorded in a journal slot.
 * `deviceId` wins when both sides know it; otherwise the normalized base URL
 * is compared. No common field means "cannot confirm" — never a match, so a
 * removal of another server can never touch this slot.
 */
export function identidadeCorresponde(
  registrada: IdentidadeArquivoRemoto | undefined,
  removida: IdentidadeArquivoRemoto | undefined,
): boolean {
  if (!registrada || !removida) return false;
  const deviceRegistrado = registrada.deviceId?.trim();
  const deviceRemovido = removida.deviceId?.trim();
  if (deviceRegistrado && deviceRemovido)
    return deviceRegistrado === deviceRemovido;
  if (registrada.baseUrl && removida.baseUrl)
    return (
      normalizarBaseUrl(registrada.baseUrl) ===
      normalizarBaseUrl(removida.baseUrl)
    );
  return false;
}
