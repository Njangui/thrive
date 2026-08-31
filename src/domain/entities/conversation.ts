import { z } from "zod";

export const HandoffStatusSchema = z.enum(["ai", "pending_human", "human", "resolved"]);
export type HandoffStatus = z.infer<typeof HandoffStatusSchema>;

export const ConversationSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  contactId: z.string().uuid(),
  channel: z.string(),
  externalThreadId: z.string().nullable(),
  handoffStatus: HandoffStatusSchema,
  handoffReason: z.string().nullable(),
  assignedUserId: z.string().uuid().nullable(),
  lastMessageAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Conversation = z.infer<typeof ConversationSchema>;

/**
 * Raisons d'escalade humaine (section 10). Volontairement une union fermée
 * de courtes raisons métier, pas une string libre, pour rester exploitable
 * dans le dashboard ("conversations nécessitant une intervention").
 */
export const HandoffReasonSchema = z.enum([
  "low_confidence",
  "complaint",
  "refund_request",
  "high_value_negotiation",
  "high_value_prospect",
  "complex_request",
  "unknown_information",
  "requires_human_action",
  "ai_unavailable",
]);

export type HandoffReason = z.infer<typeof HandoffReasonSchema>;

export const MessageSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  conversationId: z.string().uuid(),
  direction: z.enum(["inbound", "outbound"]),
  sender: z.enum(["contact", "ai", "human"]),
  content: z.string(),
  externalMessageId: z.string().nullable(),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string(),
});

export type Message = z.infer<typeof MessageSchema>;
