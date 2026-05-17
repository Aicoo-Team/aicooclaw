/** Pairing session created by Aicoo, consumed by CLI */
export interface PairingSession {
  token: string;
  pairUrl: string;
  expiresAt: string;
}

/** Result of polling pairing status */
export interface PairingStatus {
  status: "pending" | "approved" | "expired" | "failed";
  apiKey?: string;
  userId?: string;
  userName?: string;
  subAgentId?: number;
  conversationId?: number;
  error?: string;
  reason?: string;
}

/** OpenClaw Aicoo channel config */
export interface AicooChannelConfig {
  apiKey: string;
  baseUrl: string;
  subAgentId?: number;
  conversationId?: number;
  pollIntervalMs?: number;
  enabled?: boolean;
}

/** Message format between Aicoo and OpenClaw */
export interface AicooMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  senderId: string | null;
  createdAt: string;
}
