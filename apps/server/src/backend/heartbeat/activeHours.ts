import type { HeartbeatConfig } from "./types";

export function isActiveHours(config: HeartbeatConfig): boolean {
  if (!config.activeHours) return true;

  const { start, end, timezone } = config.activeHours;

  const now = new Date();

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  let hour = 0;
  let minute = 0;

  for (const part of parts) {
    if (part.type === "hour") {
      hour = parseInt(part.value, 10);
    } else if (part.type === "minute") {
      minute = parseInt(part.value, 10);
    }
  }

  const startParts = start.split(":").map(Number);
  const endParts = end.split(":").map(Number);
  const startH = startParts[0] ?? 0;
  const startM = startParts[1] ?? 0;
  const endH = endParts[0] ?? 0;
  const endM = endParts[1] ?? 0;

  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;
  const nowMinutes = hour * 60 + minute;

  if (startMinutes <= endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes <= endMinutes;
  } else {
    return nowMinutes >= startMinutes || nowMinutes <= endMinutes;
  }
}

export function getCurrentTimeInTimezone(timezone: string): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return formatter.format(now);
}
