import {getRandomBytes} from 'expo-crypto';
import {uint8ArrayToHex} from 'uint8array-extras';

/**
 * Kept in its own file (expo-crypto import) so the pure Organization modules
 * stay node-safe — integration tests import marker/reconstruct/bundle, not
 * this. Precedent: src/frontend/metrics/getMetricsDeviceId.ts.
 */
export function generateOrganizationId(): string {
  return uint8ArrayToHex(getRandomBytes(8)); // 16 hex chars
}
