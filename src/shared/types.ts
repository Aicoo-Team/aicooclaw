/** Pairing session created by Pulse, consumed by CLI */
export interface PairingSession {
  token: string;
  pairUrl: string;
  expiresAt: string;
}

/** Result of polling pairing status */
export interface PairingStatus {
  status: "pending" | "approved" | "expired";
  apiKey?: string;
  userId?: string;
  userName?: string;
  subAgentId?: number;
  conversationId?: number;
}

/** OpenClaw Pulse channel config (stored in ~/.openclaw/openclaw.json) */
export interface PulseChannelConfig {
  apiKey: string;
  baseUrl: string;
  subAgentId?: number;
  conversationId?: number;
  pollIntervalMs?: number;
  enabled?: boolean;
}

/** Message format between Pulse and OpenClaw */
export interface PulseMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  senderId: string | null;
  createdAt: string;
}
