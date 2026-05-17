/**
 * openclaw-aicoo CLI
 *
 * Usage: npx aicooclaw-systemind install
 *
 * One-liner to connect OpenClaw with Aicoo.
 * - Detects OpenClaw installation
 * - Auto-enables chatCompletions endpoint in openclaw.json
 * - Auto-detects gateway port & auth token
 * - Creates a pairing session with Aicoo
 * - Renders QR code in terminal
 * - Waits for user to scan & approve
 * - Writes credentials to OpenClaw config
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PairingSession, PairingStatus, AicooChannelConfig } from "../shared/types.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const AICOO_DEFAULT_URL = "https://www.aicoo.io";
const OPENCLAW_CONFIG_DIR = join(homedir(), ".openclaw");
const OPENCLAW_CONFIG_PATH = join(OPENCLAW_CONFIG_DIR, "openclaw.json");
const AICOO_CREDS_DIR = join(OPENCLAW_CONFIG_DIR, "credentials", "aicoo");

// ---------------------------------------------------------------------------
// ASCII Art
// ---------------------------------------------------------------------------

const BANNER = `
\x1b[36m
   █████╗ ██╗ ██████╗ ██████╗  ██████╗
  ██╔══██╗██║██╔════╝██╔═══██╗██╔═══██╗
  ███████║██║██║     ██║   ██║██║   ██║
  ██╔══██║██║██║     ██║   ██║██║   ██║
  ██║  ██║██║╚██████╗╚██████╔╝╚██████╔╝
  ╚═╝  ╚═╝╚═╝ ╚═════╝ ╚═════╝  ╚═════╝
\x1b[0m
  \x1b[2m× OpenClaw Channel Integration\x1b[0m
`;

const SUCCESS_ART = `
\x1b[32m  ╔══════════════════════════════════════╗
  ║                                      ║
  ║   ✓  Aicoo × OpenClaw Connected!     ║
  ║                                      ║
  ╚══════════════════════════════════════╝\x1b[0m
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg: string) {
  console.log(`  \x1b[2m›\x1b[0m ${msg}`);
}
function logBright(msg: string) {
  console.log(`  \x1b[36m›\x1b[0m ${msg}`);
}
function logError(msg: string) {
  console.error(`  \x1b[31m✗\x1b[0m ${msg}`);
}
function logSuccess(msg: string) {
  console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function getArgValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  const val = args[idx + 1];
  if (!val || val.startsWith("--")) return undefined;
  return val;
}

function parseOptionalInt(raw?: string): number | undefined {
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

function detectOpenClaw(): { found: boolean; version?: string } {
  try {
    const version = execSync("openclaw --version 2>/dev/null", {
      encoding: "utf-8",
    }).trim();
    return { found: true, version };
  } catch {
    try {
      execSync("npx openclaw --version 2>/dev/null", { encoding: "utf-8" });
      return { found: true, version: "npx" };
    } catch {
      return { found: false };
    }
  }
}

// ---------------------------------------------------------------------------
// OpenClaw Config (openclaw.json)
// ---------------------------------------------------------------------------

function readOpenClawConfig(): Record<string, any> {
  if (!existsSync(OPENCLAW_CONFIG_PATH)) return {};
  try {
    return JSON.parse(readFileSync(OPENCLAW_CONFIG_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function writeOpenClawConfig(config: Record<string, any>) {
  mkdirSync(OPENCLAW_CONFIG_DIR, { recursive: true });
  writeFileSync(OPENCLAW_CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

/** Read gateway port and auth token from openclaw.json */
function getGatewayInfo(config: Record<string, any>): {
  port: number;
  token: string | null;
} {
  const gw = config.gateway || {};
  const port = gw.port || 18789;
  const token = gw.auth?.token || null;
  return { port, token };
}

/** Ensure gateway.http.endpoints.chatCompletions.enabled = true */
function ensureChatCompletionsEnabled(config: Record<string, any>): boolean {
  if (!config.gateway) config.gateway = {};
  if (!config.gateway.http) config.gateway.http = {};
  if (!config.gateway.http.endpoints) config.gateway.http.endpoints = {};
  if (!config.gateway.http.endpoints.chatCompletions) {
    config.gateway.http.endpoints.chatCompletions = {};
  }

  const wasDisabled = !config.gateway.http.endpoints.chatCompletions.enabled;
  config.gateway.http.endpoints.chatCompletions.enabled = true;
  return wasDisabled;
}

function saveAicooCredentials(creds: AicooChannelConfig) {
  mkdirSync(AICOO_CREDS_DIR, { recursive: true });
  const credsPath = join(AICOO_CREDS_DIR, "creds.json");
  writeFileSync(credsPath, JSON.stringify(creds, null, 2), { mode: 0o600 });
  return credsPath;
}

// ---------------------------------------------------------------------------
// Core: Pairing Flow
// ---------------------------------------------------------------------------

async function createPairingSession(
  aicooUrl: string,
  apiEndpoint?: string,
  gatewayToken?: string | null,
): Promise<PairingSession> {
  const normalizedUrl = normalizeBaseUrl(aicooUrl);
  const res = await fetch(`${normalizedUrl}/api/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: "openclaw-cli", apiEndpoint, gatewayToken }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create pairing session: ${res.status} ${text}`);
  }

  return res.json() as Promise<PairingSession>;
}

async function pollPairingStatus(
  aicooUrl: string,
  token: string
): Promise<PairingStatus> {
  const normalizedUrl = normalizeBaseUrl(aicooUrl);
  const res = await fetch(
    `${normalizedUrl}/api/pair/status?token=${encodeURIComponent(token)}`
  );

  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    return {
      status: "failed",
      error: payload?.error || `HTTP ${res.status}`,
      reason: payload?.reason,
    };
  }

  if (!payload?.status) {
    return { status: "failed", error: "Invalid status response" };
  }

  return payload as PairingStatus;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command !== "install" && command !== "setup") {
    console.log(BANNER);
    console.log("  Usage: npx aicooclaw-systemind install [--url <aicoo-url>] [--api-endpoint <openclaw-endpoint>] [--open] [--api-key <aicoo_api_key>] [--sub-agent-id <id>] [--conversation-id <id>]");
    console.log("");
    console.log("  Commands:");
    console.log("    install    Connect OpenClaw to Aicoo (interactive)");
    console.log("");
    console.log("  Manual mode:");
    console.log("    --api-key <key>        Skip pairing and save credentials directly");
    console.log("    --sub-agent-id <id>    Optional sub-agent id for webhook delivery");
    console.log("    --conversation-id <id> Optional default conversation id");
    console.log("");
    process.exit(0);
  }

  // Parse --url flag
  const aicooUrl = getArgValue(args, "--url")
    ? getArgValue(args, "--url")!
    : AICOO_DEFAULT_URL;
  const manualApiKey = getArgValue(args, "--api-key");
  const manualSubAgentId = parseOptionalInt(getArgValue(args, "--sub-agent-id"));
  const manualConversationId = parseOptionalInt(getArgValue(args, "--conversation-id"));
  const manualApiEndpoint = getArgValue(args, "--api-endpoint");
  const shouldOpen = args.includes("--open");

  console.log(BANNER);

  // Step 1: Detect OpenClaw
  log("Detecting OpenClaw installation...");
  const oc = detectOpenClaw();
  if (!oc.found) {
    logError("OpenClaw not found.");
    log("Install it first: npm install -g openclaw");
    log("Or visit: https://github.com/nicepkg/openclaw");
    process.exit(1);
  }
  logSuccess(`OpenClaw detected ${oc.version ? `(${oc.version})` : ""}`);

  // Step 2: Read openclaw.json — auto-detect gateway config
  const ocConfig = readOpenClawConfig();
  const { port: gwPort, token: gwToken } = getGatewayInfo(ocConfig);

  logSuccess(`Gateway: localhost:${gwPort}`);
  if (gwToken) {
    logSuccess("Auth token detected");
  }

  // Step 3: Auto-enable chatCompletions endpoint
  const wasDisabled = ensureChatCompletionsEnabled(ocConfig);
  if (wasDisabled) {
    writeOpenClawConfig(ocConfig);
    logSuccess("Enabled chatCompletions endpoint in openclaw.json");
    log("Restart OpenClaw gateway for this to take effect");
  } else {
    logSuccess("chatCompletions endpoint already enabled");
  }

  // Step 4: Check if already configured
  const existingCreds = join(AICOO_CREDS_DIR, "creds.json");
  if (existsSync(existingCreds)) {
    log("Aicoo credentials already exist.");
    log("Re-running setup will overwrite existing credentials.");
    log("");
  }

  // Manual mode: skip token-based pairing entirely.
  if (manualApiKey) {
    if (!manualApiKey.startsWith("aicoo_sk_")) {
      logError("Invalid --api-key format. Expected key starting with aicoo_sk_.");
      process.exit(1);
    }

    const manualConfig: AicooChannelConfig = {
      apiKey: manualApiKey,
      baseUrl: normalizeBaseUrl(aicooUrl),
      subAgentId: manualSubAgentId,
      conversationId: manualConversationId,
      pollIntervalMs: 3000,
      enabled: true,
    };

    const credsPath = saveAicooCredentials(manualConfig);
    logSuccess("Manual key mode enabled (pairing skipped)");
    logSuccess(`Credentials saved to ${credsPath}`);
    console.log(SUCCESS_ART);
    console.log("  \x1b[1mYou're all set!\x1b[0m Manual Aicoo credentials are now configured.");
    console.log("");
    console.log("  \x1b[2mTo start OpenClaw gateway:\x1b[0m");
    console.log("  \x1b[36m  $ openclaw gateway\x1b[0m");
    console.log("");
    process.exit(0);
  }

  // Step 5: Create pairing session
  const apiEndpoint = manualApiEndpoint
    ? manualApiEndpoint
    : `http://localhost:${gwPort}/v1/chat/completions`;
  log(`Connecting to Aicoo at ${aicooUrl}...`);
  if (
    !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(aicooUrl) &&
    /^http:\/\/(localhost|127\.0\.0\.1):\d+/i.test(apiEndpoint)
  ) {
    log(
      "Warning: apiEndpoint is localhost. If pairing is approved on another device/network, verification may fail."
    );
  }

  let pairing: PairingSession;
  try {
    pairing = await createPairingSession(aicooUrl, apiEndpoint, gwToken);
  } catch (err: any) {
    logError(`Cannot reach Aicoo server: ${err.message}`);
    log(`Make sure Aicoo is running at ${aicooUrl}`);
    log("Use --url <your-aicoo-url> if running locally");
    process.exit(1);
  }
  logSuccess("Pairing session created");

  // Step 6: Render QR code
  console.log("");
  console.log("  \x1b[1m\x1b[33m┌────────────────────────────────────────┐\x1b[0m");
  console.log("  \x1b[1m\x1b[33m│  Scan this QR code to link Aicoo       │\x1b[0m");
  console.log("  \x1b[1m\x1b[33m│  Or open the URL below in your browser │\x1b[0m");
  console.log("  \x1b[1m\x1b[33m└────────────────────────────────────────┘\x1b[0m");
  console.log("");

  const qrmod = await import("qrcode-terminal");
  const qrcode = qrmod.default ?? qrmod;
  qrcode.generate(pairing.pairUrl, { small: true }, (qr: string) => {
    const lines = qr.split("\n").map((l: string) => `    ${l}`);
    console.log(lines.join("\n"));
  });

  console.log("");
  logBright(`URL: \x1b[4m${pairing.pairUrl}\x1b[0m`);
  console.log("");

  // Auto-open is opt-in to avoid accidental token invalidation caused by
  // browser prefetch/redirect behavior in some web environments.
  if (shouldOpen) {
    try {
      const openModule = await import("open");
      await openModule.default(pairing.pairUrl);
      log("Opened in your default browser");
    } catch {
      log("Open the URL above in your browser to approve");
    }
  } else {
    log("Auto-open is disabled by default. Paste the URL into your browser after signing in.");
    log("Use --open to enable automatic browser launch.");
  }

  // Step 7: Poll for approval
  console.log("");
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let frameIdx = 0;
  const maxAttempts = 120;

  for (let i = 0; i < maxAttempts; i++) {
    const frame = frames[frameIdx % frames.length];
    frameIdx++;
    process.stdout.write(
      `\r  ${frame} Waiting for approval... (${maxAttempts - i}s remaining)`
    );

    try {
      const status = await pollPairingStatus(aicooUrl, pairing.token);

      if (status.status === "approved" && status.apiKey) {
        process.stdout.write("\r" + " ".repeat(60) + "\r");
        logSuccess(`Approved by ${status.userName || "user"}!`);

        // Step 8: Save credentials & update openclaw.json
        const channelConfig: AicooChannelConfig = {
          apiKey: status.apiKey,
          baseUrl: aicooUrl,
          subAgentId: status.subAgentId,
          conversationId: status.conversationId,
          pollIntervalMs: 3000,
          enabled: true,
        };

        const credsPath = saveAicooCredentials(channelConfig);
        logSuccess(`Credentials saved to ${credsPath}`);

        // Note: We do NOT write channels/plugins to openclaw.json.
        // Aicoo calls OpenClaw's /v1/chat/completions — no OpenClaw plugin needed.
        // The credentials in ~/.openclaw/credentials/aicoo/creds.json are sufficient.

        // Step 9: Success!
        console.log(SUCCESS_ART);
        console.log(
          "  \x1b[1mYou're all set!\x1b[0m Open Aicoo and you'll see OpenClaw"
        );
        console.log("  in your contact book. Start chatting!");
        console.log("");
        console.log(`  \x1b[2mOpenClaw chatCompletions endpoint:\x1b[0m`);
        console.log(`  \x1b[36m  ${apiEndpoint}\x1b[0m`);
        console.log("");
        console.log("  \x1b[2mTo start OpenClaw gateway:\x1b[0m");
        console.log("  \x1b[36m  $ openclaw gateway\x1b[0m");
        console.log("");
        console.log("  \x1b[2mTo reconfigure:\x1b[0m");
        console.log("  \x1b[36m  $ npx aicooclaw-systemind install\x1b[0m");
        console.log("");

        process.exit(0);
      }

      if (status.status === "expired") {
        process.stdout.write("\r" + " ".repeat(60) + "\r");
        logError("Pairing session expired. Run the command again.");
        process.exit(1);
      }
      if (status.status === "failed") {
        process.stdout.write("\r" + " ".repeat(60) + "\r");
        const msg = status.error || status.reason || "Unknown error";
        logError(`Pairing failed: ${msg}`);
        if (/invalid token/i.test(msg)) {
          log("Hint: open the pair URL manually in a signed-in browser profile.");
          log("If needed, rerun with a fresh token and avoid auto-open.");
        }
        process.exit(1);
      }
    } catch {
      // Network blip — keep polling
    }

    await sleep(1000);
  }

  process.stdout.write("\r" + " ".repeat(60) + "\r");
  logError("Timed out waiting for approval. Run the command again.");
  process.exit(1);
}

main().catch((err) => {
  logError(err.message || String(err));
  process.exit(1);
});
