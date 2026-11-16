import {DeviceDiagnostics} from './DeviceDiagnosticMetrics.ts';

export const deviceDiagnostics = new DeviceDiagnostics();

export function applyDiagnosticsPreference(enabled: boolean): void {
  deviceDiagnostics.setEnabled(enabled);
}
