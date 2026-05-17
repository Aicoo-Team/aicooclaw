/**
 * Aicoo Channel Plugin for OpenClaw — Entry Point
 *
 * This is the main plugin export that OpenClaw discovers and loads.
 * It registers the Aicoo channel so OpenClaw can communicate through Aicoo.
 */

import { aicooPlugin } from "./channel.js";
import { setAicooRuntime } from "./runtime.js";

const plugin = {
  id: "aicoo",
  name: "Aicoo",
  description:
    "Connect OpenClaw to Aicoo — your AI-native communication platform. " +
    "Send and receive messages through Aicoo just like WhatsApp or Telegram.",

  register(api: any) {
    // Store runtime reference for later use
    setAicooRuntime(api.runtime);

    // Register the Aicoo channel
    api.registerChannel({ plugin: aicooPlugin });

    // Log activation
    const config = api.config?.channels?.aicoo;
    if (config?.apiKey) {
      console.log(
        `[aicoo] Plugin activated — connected to ${config.baseUrl || "https://www.aicoo.io"}`
      );
    } else {
      console.log(
        "[aicoo] Plugin loaded but not configured. Run: npx aicooclaw-systemind install"
      );
    }
  },
};

export default plugin;
