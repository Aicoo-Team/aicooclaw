/**
 * Aicoo Channel Plugin for OpenClaw
 *
 * Implements the ChannelPlugin interface so OpenClaw can
 * send and receive messages through Aicoo.
 *
 * Message flow:
 *   Aicoo user sends message
 *     → Aicoo POSTs to OpenClaw webhook (/webhook/aicoo)
 *     → OpenClaw processes with agent
 *     → OpenClaw calls sendText() → POST to Aicoo API
 *     → Aicoo displays response in chat UI
 */

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

interface ResolvedAicooAccount {
  accountId: string;
  name: string;
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  subAgentId?: number;
  conversationId?: number;
}

// ---------------------------------------------------------------------------
// Aicoo API Client
// ---------------------------------------------------------------------------

async function sendMessageToAicoo(
  account: ResolvedAicooAccount,
  to: string, // conversationId
  text: string
): Promise<OutboundDeliveryResult> {
  const baseUrl = normalizeBaseUrl(account.baseUrl);
  const conversationId =
    parseInt(to, 10) || account.conversationId;

  if (!conversationId) {
    return { ok: false, error: "No conversation ID" };
  }

  try {
    const res = await fetch(
      `${baseUrl}/api/sub-agents/webhook`,
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
        error: `Aicoo API returned ${res.status}`,
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

export const aicooPlugin = {
  id: "aicoo" as const,

  meta: {
    id: "aicoo",
    label: "Aicoo",
    selectionLabel: "Aicoo (AI Communication Platform)",
    docsPath: "/channels/aicoo",
    docsLabel: "aicoo",
    blurb: "Aicoo messaging platform integration",
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
  // Config Adapter — how OpenClaw manages Aicoo accounts
  // ---------------------------------------------------------------------------
  config: {
    listAccountIds(cfg: any): string[] {
      const aicoo = cfg?.channels?.aicoo;
      if (!aicoo) return [];
      if (aicoo.accounts) return Object.keys(aicoo.accounts);
      if (aicoo.apiKey) return ["default"];
      return [];
    },

    resolveAccount(
      cfg: any,
      accountId: string
    ): ResolvedAicooAccount | null {
      const aicoo = cfg?.channels?.aicoo;
      if (!aicoo) return null;

      const acct = aicoo.accounts?.[accountId] ?? aicoo;
      if (!acct?.apiKey) return null;

      return {
        accountId,
        name: acct.name || "Aicoo",
        enabled: acct.enabled !== false,
        apiKey: acct.apiKey,
        baseUrl: normalizeBaseUrl(acct.baseUrl || "https://www.aicoo.io"),
        subAgentId: acct.subAgentId,
        conversationId: acct.conversationId,
      };
    },

    isConfigured(account: ResolvedAicooAccount | null): boolean {
      return !!account?.apiKey;
    },

    isEnabled(account: ResolvedAicooAccount | null): boolean {
      return !!account?.enabled;
    },

    describeAccount(account: ResolvedAicooAccount): string {
      return `${account.name} (${account.baseUrl})`;
    },
  },

  // ---------------------------------------------------------------------------
  // Outbound Adapter — OpenClaw → Aicoo
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
      const account = aicooPlugin.config.resolveAccount(
        ctx.cfg,
        accountId
      );
      if (!account) {
        return { ok: false, error: "Aicoo account not configured" };
      }

      return sendMessageToAicoo(account, ctx.to, ctx.text);
    },
  },

  // ---------------------------------------------------------------------------
  // Gateway Adapter — manages the Aicoo connection lifecycle
  // ---------------------------------------------------------------------------
  gateway: {
    async startAccount(ctx: {
      cfg: any;
      accountId: string;
      account: ResolvedAicooAccount;
      runtime: any;
      abortSignal: AbortSignal;
    }) {
      const { account, runtime, abortSignal } = ctx;

      console.log(
        `[aicoo] Channel started for ${account.name} (${account.baseUrl})`
      );

      // Register webhook endpoint to receive messages from Aicoo
      // Aicoo will POST here when user sends a message to the sub-agent
      runtime?.registerHttpRoute?.({
        path: "/webhook/aicoo",
        auth: "public", // Aicoo authenticates via API key in body
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
              `[aicoo] Inbound message from ${senderId}: ${message.substring(0, 50)}...`
            );

            // Acknowledge receipt immediately
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ received: true }));

            // TODO: Route to agent via runtime API
            // This would trigger agent processing and the response
            // would be sent back via the outbound adapter

            return true;
          } catch (err: any) {
            console.error("[aicoo] Webhook error:", err.message);
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Internal error" }));
            return true;
          }
        },
      });

      // Keep alive until shutdown
      return new Promise<void>((resolve) => {
        abortSignal.addEventListener("abort", () => {
          console.log("[aicoo] Channel shutting down");
          resolve();
        });
      });
    },

    async logoutAccount(ctx: {
      account: ResolvedAicooAccount;
    }) {
      console.log(`[aicoo] Logged out ${ctx.account.name}`);
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
      account: ResolvedAicooAccount;
    }) {
      try {
        const baseUrl = normalizeBaseUrl(ctx.account.baseUrl);
        const res = await fetch(`${baseUrl}/api/health`, {
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

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}
