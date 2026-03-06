import type { NotificationDeviceRecord } from "@agent-mockingbird/contracts/dashboard";

import { sqlite } from "../db/client";

interface NotificationDeviceRow {
  installation_id: string;
  expo_push_token: string;
  platform: "ios" | "android";
  enabled: number;
  label: string | null;
  created_at: number;
  updated_at: number;
  last_seen_at: number;
}

function nowMs() {
  return Date.now();
}

function toIso(value: number) {
  return new Date(value).toISOString();
}

function rowToRecord(row: NotificationDeviceRow): NotificationDeviceRecord {
  return {
    installationId: row.installation_id,
    expoPushToken: row.expo_push_token,
    platform: row.platform,
    enabled: row.enabled === 1,
    label: row.label,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    lastSeenAt: toIso(row.last_seen_at),
  };
}

function ensureNotificationTables() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS notification_devices (
      installation_id TEXT PRIMARY KEY,
      expo_push_token TEXT NOT NULL,
      platform TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      label TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS notification_devices_enabled_idx
      ON notification_devices(enabled, updated_at DESC);
  `);
}

ensureNotificationTables();

export function listNotificationDevices(): NotificationDeviceRecord[] {
  const rows = sqlite
    .query(
      `
        SELECT installation_id, expo_push_token, platform, enabled, label, created_at, updated_at, last_seen_at
        FROM notification_devices
        ORDER BY updated_at DESC
      `,
    )
    .all() as NotificationDeviceRow[];
  return rows.map(rowToRecord);
}

export function listEnabledNotificationDevices(): NotificationDeviceRecord[] {
  const rows = sqlite
    .query(
      `
        SELECT installation_id, expo_push_token, platform, enabled, label, created_at, updated_at, last_seen_at
        FROM notification_devices
        WHERE enabled = 1
        ORDER BY updated_at DESC
      `,
    )
    .all() as NotificationDeviceRow[];
  return rows.map(rowToRecord);
}

export function upsertNotificationDevice(input: {
  installationId: string;
  expoPushToken: string;
  platform: "ios" | "android";
  label?: string;
}): NotificationDeviceRecord {
  const stamp = nowMs();
  sqlite
    .query(
      `
        INSERT INTO notification_devices (
          installation_id, expo_push_token, platform, enabled, label, created_at, updated_at, last_seen_at
        )
        VALUES (?1, ?2, ?3, 1, ?4, ?5, ?5, ?5)
        ON CONFLICT(installation_id) DO UPDATE SET
          expo_push_token = excluded.expo_push_token,
          platform = excluded.platform,
          enabled = 1,
          label = excluded.label,
          updated_at = excluded.updated_at,
          last_seen_at = excluded.last_seen_at
      `,
    )
    .run(input.installationId, input.expoPushToken, input.platform, input.label ?? null, stamp);

  return getNotificationDevice(input.installationId) as NotificationDeviceRecord;
}

export function setNotificationDeviceEnabled(input: {
  installationId: string;
  enabled: boolean;
}): NotificationDeviceRecord {
  const stamp = nowMs();
  sqlite
    .query(
      `
        UPDATE notification_devices
        SET enabled = ?2,
            updated_at = ?3,
            last_seen_at = ?3
        WHERE installation_id = ?1
      `,
    )
    .run(input.installationId, input.enabled ? 1 : 0, stamp);

  const device = getNotificationDevice(input.installationId);
  if (!device) {
    throw new Error("Unknown installation");
  }
  return device;
}

export function getNotificationDevice(installationId: string): NotificationDeviceRecord | null {
  const row = sqlite
    .query(
      `
        SELECT installation_id, expo_push_token, platform, enabled, label, created_at, updated_at, last_seen_at
        FROM notification_devices
        WHERE installation_id = ?1
      `,
    )
    .get(installationId) as NotificationDeviceRow | null;
  return row ? rowToRecord(row) : null;
}

export function removeNotificationDevice(installationId: string) {
  const result = sqlite.query(`DELETE FROM notification_devices WHERE installation_id = ?1`).run(installationId);
  return result.changes > 0;
}
