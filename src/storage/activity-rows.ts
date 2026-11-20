import type { Activity, ActivityType } from '../core';
import { iso } from './entry-rows';

export interface ActivityRow {
  id: string; created_at: number; updated_at: number; deleted_at: number | null; device_id: string;
  type: string; occurred_at: number; repo: string; branch: string | null; external_id: string;
  title: string | null; url: string | null; captured_by: string | null; payload: string | null;
}

/** Build an Activity from a row. `pr` comes from the payload. A bad payload reads as an empty one. */
export function rowToActivity(r: ActivityRow): Activity {
  let payload: Record<string, unknown> = {};
  try {
    const parsed: unknown = r.payload ? JSON.parse(r.payload) : {};
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>;
  } catch { /* keep the empty payload */ }
  return {
    id: r.id,
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
    deletedAt: iso(r.deleted_at),
    deviceId: r.device_id,
    type: r.type as ActivityType,
    occurredAt: iso(r.occurred_at)!,
    repo: r.repo,
    branch: r.branch,
    externalId: r.external_id,
    title: r.title,
    url: r.url,
    capturedBy: 'github',
    pr: typeof payload.pr === 'number' && Number.isInteger(payload.pr) ? payload.pr : null,
    payload,
  };
}

/** The payload text that is stored: the caller's fields plus `pr`, so linking can read it with json_extract. */
export function payloadText(payload: Record<string, unknown>, pr: number | null): string {
  return JSON.stringify({ ...payload, pr });
}
