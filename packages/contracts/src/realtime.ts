import { z } from "zod";

export const realtimeEventTypeSchema = z.enum([
  "heartbeat.updated",
  "session.state.updated",
  "session.message.created",
  "session.message.delta",
  "session.run.status.updated",
  "session.run.error",
  "session.permission.requested",
  "session.question.requested",
  "background.run.updated",
]);

export const realtimeEnvelopeSchema = z.object({
  id: z.string().min(1),
  type: realtimeEventTypeSchema,
  at: z.string().min(1),
  source: z.enum(["api", "runtime", "scheduler", "system"]),
  payload: z.record(z.string(), z.unknown()).or(z.array(z.unknown())).or(z.string()).or(z.number()).or(z.boolean()).or(z.null()),
});

export type RealtimeEventType = z.infer<typeof realtimeEventTypeSchema>;
export type RealtimeEnvelope = z.infer<typeof realtimeEnvelopeSchema>;
