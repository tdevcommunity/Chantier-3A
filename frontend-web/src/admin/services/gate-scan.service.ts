import { apiFetch } from './api';

export type ScanControlType = 'event_entry' | 'food_access' | 'merch_pickup' | 'after_entry';

export interface ScanPreview {
  ticket_id: string;
  serial: string;
  holder_name: string;
  pass_label: string;
  email_masked: string;
  status: string;
  admitted: boolean;
}

export interface ScanResult {
  result: string;
  reason?: string;
  ticket_id?: string;
  serial?: string;
  holder_name?: string;
  participant?: Record<string, unknown> | null;
  first_scan?: Record<string, unknown> | null;
}

export const gateScanService = {
  listEvents() {
    return apiFetch<{ events: { id: string; title: string; scan_role: string }[] }>('/scan/events');
  },

  lookupSerial(eventId: string, serialSuffix: string) {
    return apiFetch<{ found: boolean; reason?: string; preview?: ScanPreview }>('/scan/lookup-serial', {
      method: 'POST',
      body: JSON.stringify({ event_id: eventId, serial_suffix: serialSuffix }),
    });
  },

  lookupName(eventId: string, query: string) {
    return apiFetch<{ matches: ScanPreview[]; truncated?: boolean }>('/scan/lookup-name', {
      method: 'POST',
      body: JSON.stringify({ event_id: eventId, query }),
    });
  },

  admitBySerial(
    eventId: string,
    opts: { serial?: string; serialSuffix?: string; controlType?: ScanControlType },
  ) {
    return apiFetch<ScanResult>('/scan/by-serial', {
      method: 'POST',
      body: JSON.stringify({
        event_id: eventId,
        serial: opts.serial || '',
        serial_suffix: opts.serialSuffix || '',
        control_type: opts.controlType || 'event_entry',
        gate_id: 'web-gate',
        device_id: 'web-scanner',
      }),
    });
  },
};