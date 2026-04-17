/**
 * openclaw-pulse CLI
 *
 * Usage: npx pulseclaw-systemind install
 *
 * One-liner to connect OpenClaw with Pulse.
 * - Detects OpenClaw installation
 * - Auto-enables chatCompletions endpoint in openclaw.json
 * - Auto-detects gateway port & auth token
 * - Creates a pairing session with Pulse
 * - Renders QR code in terminal
 * - Waits for user to scan & approve
 * - Writes credentials to OpenClaw config
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PairingSession, PairingStatus, PulseChannelConfig } from "../shared/types.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const PULSE_DEFAULT_URL = "https://pulse-ai.world";
const OPENCLAW_CONFIG_DIR = join(homedir(), ".openclaw");
const OPENCLAW_CONFIG_PATH = join(OPENCLAW_CONFIG_DIR, "openclaw.json");
const PULSE_CREDS_DIR = join(OPENCLAW_CONFIG_DIR, "credentials", "pulse");

// ---------------------------------------------------------------------------
// ASCII Art
// ---------------------------------------------------------------------------

const BANNER = `
\x1b[36m
  ██████╗ ██╗   ██╗██╗     ███████╗███████╗
  ██╔══██╗██║   ██║██║     ██╔════╝██╔════╝
  ██████╔╝██║   ██║██║     ███████╗█████╗
  ██╔═══╝ ██║   ██║██║     ╚════██║██╔══╝
  ██║     ╚██████╔╝███████╗███████║███████╗
  ╚═╝      ╚═════╝ ╚══════╝╚══════╝╚══════╝
\x1b[0m
  \x1b[2m× OpenClaw Channel Integration\x1b[0m
`;

const SUCCESS_ART = `
\x1b[32m  ╔══════════════════════════════════════╗
  ║                                      ║
  ║   ✓  Pulse × OpenClaw Connected!     ║
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

function savePulseCredentials(creds: PulseChannelConfig) {
  mkdirSync(PULSE_CREDS_DIR, { recursive: true });
  const credsPath = join(PULSE_CREDS_DIR, "creds.json");
  writeFileSync(credsPath, JSON.stringify(creds, null, 2), { mode: 0o600 });
  return credsPath;
}

// ---------------------------------------------------------------------------
// Core: Pairing Flow
// ---------------------------------------------------------------------------

async function createPairingSession(
  pulseUrl: string,
  apiEndpoint?: string,
  gatewayToken?: string | null,
): Promise<PairingSession> {
  const res = await fetch(`${pulseUrl}/api/pair`, {
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
  pulseUrl: string,
  token: string
): Promise<PairingStatus> {
  const res = await fetch(
    `${pulseUrl}/api/pair/status?token=${encodeURIComponent(token)}`
  );

  if (!res.ok) {
    throw new Error(`Pairing status check failed: ${res.status}`);
  }

  return res.json() as Promise<PairingStatus>;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command !== "install" && command !== "setup") {
    console.log(BANNER);
    console.log("  Usage: npx pulseclaw-systemind install [--url <pulse-url>]");
    console.log("");
    console.log("  Commands:");
    console.log("    install    Connect OpenClaw to Pulse (interactive)");
    console.log("");
    process.exit(0);
  }

  // Parse --url flag
  const urlIdx = args.indexOf("--url");
  const pulseUrl = urlIdx !== -1 && args[urlIdx + 1]
    ? args[urlIdx + 1]
    : PULSE_DEFAULT_URL;

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
  const existingCreds = join(PULSE_CREDS_DIR, "creds.json");
  if (existsSync(existingCreds)) {
    log("Pulse credentials already exist.");
    log("Re-running setup will overwrite existing credentials.");
    log("");
  }

  // Step 5: Create pairing session
  const apiEndpoint = `http://localhost:${gwPort}/v1/chat/completions`;
  log(`Connecting to Pulse at ${pulseUrl}...`);

  let pairing: PairingSession;
  try {
    pairing = await createPairingSession(pulseUrl, apiEndpoint, gwToken);
  } catch (err: any) {
    logError(`Cannot reach Pulse server: ${err.message}`);
    log(`Make sure Pulse is running at ${pulseUrl}`);
    log("Use --url <your-pulse-url> if running locally");
    process.exit(1);
  }
  logSuccess("Pairing session created");

  // Step 6: Render QR code
  console.log("");
  console.log("  \x1b[1m\x1b[33m┌────────────────────────────────────────┐\x1b[0m");
  console.log("  \x1b[1m\x1b[33m│  Scan this QR code to link Pulse       │\x1b[0m");
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

  // Try to open browser automatically
  try {
    const openModule = await import("open");
    await openModule.default(pairing.pairUrl);
    log("Opened in your default browser");
  } catch {
    log("Open the URL above in your browser to approve");
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
      const status = await pollPairingStatus(pulseUrl, pairing.token);

      if (status.status === "approved" && status.apiKey) {
        process.stdout.write("\r" + " ".repeat(60) + "\r");
        logSuccess(`Approved by ${status.userName || "user"}!`);

        // Step 8: Save credentials & update openclaw.json
        const apiEndpoint = `http://localhost:${gwPort}/v1/chat/completions`;

        const channelConfig: PulseChannelConfig = {
          apiKey: status.apiKey,
          baseUrl: pulseUrl,
          subAgentId: status.subAgentId,
          conversationId: status.conversationId,
          pollIntervalMs: 3000,
          enabled: true,
        };

        const credsPath = savePulseCredentials(channelConfig);
        logSuccess(`Credentials saved to ${credsPath}`);

        // Note: We do NOT write channels/plugins to openclaw.json.
        // Pulse calls OpenClaw's /v1/chat/completions — no OpenClaw plugin needed.
        // The credentials in ~/.openclaw/credentials/pulse/creds.json are sufficient.

        // Step 9: Success!
        console.log(SUCCESS_ART);
        console.log(
          "  \x1b[1mYou're all set!\x1b[0m Open Pulse and you'll see OpenClaw"
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
        console.log("  \x1b[36m  $ npx pulseclaw-systemind install\x1b[0m");
        console.log("");

        process.exit(0);
      }

      if (status.status === "expired") {
        process.stdout.write("\r" + " ".repeat(60) + "\r");
        logError("Pairing session expired. Run the command again.");
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
