/**
 * Pulse Channel Plugin for OpenClaw — Entry Point
 *
 * This is the main plugin export that OpenClaw discovers and loads.
 * It registers the Pulse channel so OpenClaw can communicate through Pulse.
 */

import { pulsePlugin } from "./channel.js";
import { setPulseRuntime } from "./runtime.js";

const plugin = {
  id: "pulse",
  name: "Pulse",
  description:
    "Connect OpenClaw to Pulse — your AI-native communication platform. " +
    "Send and receive messages through Pulse just like WhatsApp or Telegram.",

  register(api: any) {
    // Store runtime reference for later use
    setPulseRuntime(api.runtime);

    // Register the Pulse channel
    api.registerChannel({ plugin: pulsePlugin });

    // Log activation
    const config = api.config?.channels?.pulse;
    if (config?.apiKey) {
      console.log(
        `[pulse] Plugin activated — connected to ${config.baseUrl || "https://pulse-ai.world"}`
      );
    } else {
      console.log(
        "[pulse] Plugin loaded but not configured. Run: npx pulseclaw-systemind install"
      );
    }
  },
};

export default plugin;
