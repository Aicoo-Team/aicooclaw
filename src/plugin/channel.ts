/**
 * Pulse Channel Plugin for OpenClaw
 *
 * Implements the ChannelPlugin interface so OpenClaw can
 * send and receive messages through Pulse.
 *
 * Message flow:
 *   Pulse user sends message
 *     → Pulse POSTs to OpenClaw webhook (/webhook/pulse)
 *     → OpenClaw processes with agent
 *     → OpenClaw calls sendText() → POST to Pulse API
 *     → Pulse displays response in chat UI
 */

import type { PulseChannelConfig, PulseMessage } from "../shared/types.js";

// ---------------------------------------------------------------------------
// Types (matching OpenClaw's ChannelPlugin interface)
// ---------------------------------------------------------------------------

interface ChannelCapabilities {
  chatTypes: ("direct" | "group")[];
  polls?: boolean;
  reactions?: boolean;
  threads?: boolean;
  media?: boolean;
  blockStreaming?: boolean;
}

interface OutboundDeliveryResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

interface ResolvedPulseAccount {
  accountId: string;
  name: string;
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  subAgentId?: number;
  conversationId?: number;
}

// ---------------------------------------------------------------------------
// Pulse API Client
// ---------------------------------------------------------------------------

async function sendMessageToPulse(
  account: ResolvedPulseAccount,
  to: string, // conversationId
  text: string
): Promise<OutboundDeliveryResult> {
  const conversationId =
    parseInt(to, 10) || account.conversationId;

  if (!conversationId) {
    return { ok: false, error: "No conversation ID" };
  }

  try {
    const res = await fetch(
      `${account.baseUrl}/api/sub-agents/webhook`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${account.apiKey}`,
        },
        body: JSON.stringify({
          subAgentId: account.subAgentId,
          conversationId,
          messages: [{ role: "assistant", content: text }],
        }),
        signal: AbortSignal.timeout(30_000),
      }
    );

    if (!res.ok) {
      return {
        ok: false,
        error: `Pulse API returned ${res.status}`,
      };
    }

    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Channel Plugin Definition
// ---------------------------------------------------------------------------

export const pulsePlugin = {
  id: "pulse" as const,

  meta: {
    id: "pulse",
    label: "Pulse",
    selectionLabel: "Pulse (AI Communication Platform)",
    docsPath: "/channels/pulse",
    docsLabel: "pulse",
    blurb: "Pulse messaging platform integration",
    order: 85,
  },

  capabilities: {
    chatTypes: ["direct"],
    polls: false,
    reactions: false,
    threads: false,
    media: false, // TODO: Phase 2
    blockStreaming: false,
  } satisfies ChannelCapabilities,

  // ---------------------------------------------------------------------------
  // Config Adapter — how OpenClaw manages Pulse accounts
  // ---------------------------------------------------------------------------
  config: {
    listAccountIds(cfg: any): string[] {
      const pulse = cfg?.channels?.pulse;
      if (!pulse) return [];
      if (pulse.accounts) return Object.keys(pulse.accounts);
      if (pulse.apiKey) return ["default"];
      return [];
    },

    resolveAccount(
      cfg: any,
      accountId: string
    ): ResolvedPulseAccount | null {
      const pulse = cfg?.channels?.pulse;
      if (!pulse) return null;

      const acct = pulse.accounts?.[accountId] ?? pulse;
      if (!acct?.apiKey) return null;

      return {
        accountId,
        name: acct.name || "Pulse",
        enabled: acct.enabled !== false,
        apiKey: acct.apiKey,
        baseUrl: acct.baseUrl || "https://pulse-ai.world",
        subAgentId: acct.subAgentId,
        conversationId: acct.conversationId,
      };
    },

    isConfigured(account: ResolvedPulseAccount | null): boolean {
      return !!account?.apiKey;
    },

    isEnabled(account: ResolvedPulseAccount | null): boolean {
      return !!account?.enabled;
    },

    describeAccount(account: ResolvedPulseAccount): string {
      return `${account.name} (${account.baseUrl})`;
    },
  },

  // ---------------------------------------------------------------------------
  // Outbound Adapter — OpenClaw → Pulse
  // ---------------------------------------------------------------------------
  outbound: {
    deliveryMode: "direct" as const,
    textChunkLimit: 4000,

    async sendText(ctx: {
      cfg: any;
      to: string;
      text: string;
      accountId?: string;
    }): Promise<OutboundDeliveryResult> {
      const accountId = ctx.accountId || "default";
      const account = pulsePlugin.config.resolveAccount(
        ctx.cfg,
        accountId
      );
      if (!account) {
        return { ok: false, error: "Pulse account not configured" };
      }

      return sendMessageToPulse(account, ctx.to, ctx.text);
    },
  },

  // ---------------------------------------------------------------------------
  // Gateway Adapter — manages the Pulse connection lifecycle
  // ---------------------------------------------------------------------------
  gateway: {
    async startAccount(ctx: {
      cfg: any;
      accountId: string;
      account: ResolvedPulseAccount;
      runtime: any;
      abortSignal: AbortSignal;
    }) {
      const { account, runtime, abortSignal } = ctx;

      console.log(
        `[pulse] Channel started for ${account.name} (${account.baseUrl})`
      );

      // Register webhook endpoint to receive messages from Pulse
      // Pulse will POST here when user sends a message to the sub-agent
      runtime?.registerHttpRoute?.({
        path: "/webhook/pulse",
        auth: "public", // Pulse authenticates via API key in body
        handler: async (req: any, res: any) => {
          try {
            const body = await readRequestBody(req);
            const data = JSON.parse(body);

            // Verify the API key matches
            if (data.apiKey !== account.apiKey) {
              res.writeHead(401, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Unauthorized" }));
              return true;
            }

            const { message, senderId, conversationId } = data;

            if (!message) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Missing message" }));
              return true;
            }

            // Route message to OpenClaw agent
            // The runtime handles agent dispatch
            console.log(
              `[pulse] Inbound message from ${senderId}: ${message.substring(0, 50)}...`
            );

            // Acknowledge receipt immediately
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ received: true }));

            // TODO: Route to agent via runtime API
            // This would trigger agent processing and the response
            // would be sent back via the outbound adapter

            return true;
          } catch (err: any) {
            console.error("[pulse] Webhook error:", err.message);
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Internal error" }));
            return true;
          }
        },
      });

      // Keep alive until shutdown
      return new Promise<void>((resolve) => {
        abortSignal.addEventListener("abort", () => {
          console.log("[pulse] Channel shutting down");
          resolve();
        });
      });
    },

    async logoutAccount(ctx: {
      account: ResolvedPulseAccount;
    }) {
      console.log(`[pulse] Logged out ${ctx.account.name}`);
      return { cleared: true, loggedOut: true };
    },
  },

  // ---------------------------------------------------------------------------
  // Status Adapter
  // ---------------------------------------------------------------------------
  status: {
    async probeAccount(ctx: {
      cfg: any;
      accountId: string;
      account: ResolvedPulseAccount;
    }) {
      try {
        const res = await fetch(`${ctx.account.baseUrl}/api/health`, {
          signal: AbortSignal.timeout(5000),
        });
        return {
          ok: res.ok,
          connected: res.ok,
          reason: res.ok ? "Connected" : `HTTP ${res.status}`,
        };
      } catch (err: any) {
        return { ok: false, connected: false, reason: err.message };
      }
    },
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readRequestBody(req: any): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}
