import type { RuntimeEvent } from "../contracts/events";
import { env } from "../env";
import { listEnabledNotificationDevices } from "./repository";

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
}

function buildMessagesForEvent(event: RuntimeEvent): ExpoPushMessage[] {
  const devices = listEnabledNotificationDevices();
  if (devices.length === 0) return [];

  if (event.type === "session.message.created") {
    if (event.payload.message.role !== "assistant") return [];
    const body = event.payload.message.content.trim();
    if (!body) return [];
    return devices.map(device => ({
      to: device.expoPushToken,
      title: "Wafflebot replied",
      body: body.slice(0, 180),
      data: {
        eventType: event.type,
        sessionId: event.payload.sessionId,
      },
    }));
  }

  if (event.type === "session.permission.requested") {
    return devices.map(device => ({
      to: device.expoPushToken,
      title: "Permission required",
      body: `Agent needs approval for ${event.payload.permission}.`,
      data: {
        eventType: event.type,
        sessionId: event.payload.sessionId,
        requestId: event.payload.id,
      },
    }));
  }

  if (event.type === "session.question.requested") {
    return devices.map(device => ({
      to: device.expoPushToken,
      title: "Agent asked a question",
      body: event.payload.questions[0]?.question?.slice(0, 180) ?? "Open the app to respond.",
      data: {
        eventType: event.type,
        sessionId: event.payload.sessionId,
        requestId: event.payload.id,
      },
    }));
  }

  return [];
}

export class NotificationService {
  async publishRuntimeEvent(event: RuntimeEvent) {
    const messages = buildMessagesForEvent(event);
    if (messages.length === 0) return;

    try {
      const response = await fetch(env.WAFFLEBOT_EXPO_PUSH_API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(messages),
      });

      if (!response.ok) {
        console.warn("[notifications] Expo push request failed", response.status);
      }
    } catch (error) {
      console.warn("[notifications] Expo push dispatch failed", error);
    }
  }
}
