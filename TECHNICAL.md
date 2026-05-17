# Aicoo OpenClaw Integration Technical Notes

This document describes the current `aicooclaw-systemind` architecture as of
version `0.1.5`.

## Overview

The integration connects an Aicoo cloud account to a local OpenClaw gateway. It
has two phases:

1. Pairing: browser approval creates an Aicoo API key and registers an OpenClaw
   sub-agent for the signed-in user.
2. Relay: a local CLI process polls Aicoo for messages, forwards them to the
   local OpenClaw gateway, and posts the result back to Aicoo.

The relay is required because `http://localhost:18789` is only reachable from
the user's machine. A Vercel serverless function cannot call that address.

## Components

### npm Package

Package name:

```text
aicooclaw-systemind
```

Binary:

```text
aicooclaw
```

Important files:

- `src/cli/install.ts`: install, pairing, and relay CLI.
- `src/shared/types.ts`: shared TypeScript interfaces.
- `src/plugin/index.ts`: OpenClaw plugin entry.
- `src/plugin/channel.ts`: channel adapter shell.
- `openclaw.plugin.json`: OpenClaw plugin metadata and config schema.

### Aicoo Backend

The backend lives in the Aicoo web app, not in this npm package. The current
integration expects these endpoints to exist on the Aicoo base URL:

- `POST /api/pair`
- `GET /api/pair/status?token=<token>`
- `POST /api/pair/approve`
- `POST /api/sub-agents/chat`
- `POST /api/sub-agents/relay/poll`
- `POST /api/sub-agents/relay/respond`

Pairing and relay state are backed by Upstash Redis.

## Pairing Flow

### 1. CLI Creates Pairing Session

The CLI calls:

```http
POST /api/pair
Content-Type: application/json

{
  "source": "openclaw-cli",
  "apiEndpoint": "http://localhost:18789/v1/chat/completions",
  "gatewayToken": "<openclaw gateway auth token>"
}
```

Aicoo responds:

```json
{
  "token": "...",
  "pairUrl": "https://www.aicoo.io/pair?token=...",
  "expiresAt": "2026-05-18T12:00:00.000Z"
}
```

The CLI renders the pair URL as both plain text and QR code.

### 2. User Approves In Browser

The user opens the pair URL while signed in to Aicoo. The Aicoo backend:

- validates the pairing token
- creates an Aicoo API key
- creates or refreshes an `OpenClaw` sub-agent
- stores the local OpenClaw endpoint and gateway token on the sub-agent
- marks the pairing session as approved

Re-pairing is idempotent: if the user already has an `OpenClaw` sub-agent, the
backend updates it instead of inserting a duplicate.

### 3. CLI Polls Pairing Status

The CLI polls:

```http
GET /api/pair/status?token=<token>
```

When approved, Aicoo returns:

```json
{
  "status": "approved",
  "apiKey": "aicoo_sk_live_...",
  "userId": "...",
  "userName": "...",
  "subAgentId": 123,
  "conversationId": 456
}
```

The CLI writes:

```text
~/.openclaw/credentials/aicoo/creds.json
```

Then it starts relay mode automatically.

## Relay Flow

### Why Relay Exists

The OpenClaw gateway normally runs on:

```text
http://localhost:18789/v1/chat/completions
```

From Aicoo's cloud runtime, that address does not refer to the user's machine.
It refers to the serverless runtime itself. Direct cloud-to-local fetch therefore
fails with errors like:

```text
Failed to reach sub-agent: fetch failed
```

The relay avoids requiring ngrok, Tailscale, Cloudflare Tunnel, or a public
OpenClaw endpoint.

### 1. Aicoo Enqueues Work

When a user sends a message to the OpenClaw sub-agent, Aicoo creates a relay
request in Upstash Redis. The request contains:

```json
{
  "id": "...",
  "userId": "...",
  "subAgentId": 123,
  "conversationId": 456,
  "messages": [
    { "role": "user", "content": "hi" }
  ],
  "createdAt": "2026-05-18T12:00:00.000Z",
  "status": "pending"
}
```

The web request waits for the relay request to complete or time out.

### 2. CLI Polls For Work

The local CLI calls:

```http
POST /api/sub-agents/relay/poll
Authorization: Bearer <aicoo api key>
Content-Type: application/json

{}
```

If there is work, Aicoo returns:

```json
{
  "request": {
    "id": "...",
    "messages": [
      { "role": "user", "content": "hi" }
    ]
  }
}
```

If there is no work:

```json
{
  "request": null
}
```

### 3. CLI Calls Local OpenClaw

The CLI forwards the messages to:

```http
POST http://localhost:18789/v1/chat/completions
Authorization: Bearer <openclaw gateway token>
Content-Type: application/json

{
  "model": "openclaw",
  "messages": [...],
  "stream": false
}
```

The CLI accepts OpenAI-style responses:

```json
{
  "choices": [
    {
      "message": {
        "content": "..."
      }
    }
  ]
}
```

It also falls back to `response`, `text`, `message`, or raw JSON string.

### 4. CLI Posts Result Back

Success:

```http
POST /api/sub-agents/relay/respond
Authorization: Bearer <aicoo api key>
Content-Type: application/json

{
  "requestId": "...",
  "response": "OpenClaw response"
}
```

Failure:

```json
{
  "requestId": "...",
  "error": "OpenClaw returned 500: ..."
}
```

Aicoo stores the assistant message in the chat conversation.

## Data Storage

### Local Files

OpenClaw config:

```text
~/.openclaw/openclaw.json
```

Aicoo credentials:

```text
~/.openclaw/credentials/aicoo/creds.json
```

The old Pulse path is not used:

```text
~/.openclaw/credentials/pulse/
```

### Upstash Redis Keys

Pairing keys:

```text
pairing:openclaw:<token>
```

Relay queue:

```text
subagent-relay:queue:<userId>
```

Relay request:

```text
subagent-relay:request:<requestId>
```

Pairing sessions and relay requests are short-lived and expire automatically.

## Security Model

- Browser approval requires an authenticated Aicoo session.
- The CLI receives a scoped Aicoo API key only after approval.
- Relay endpoints authenticate with `Authorization: Bearer <aicoo api key>`.
- The local OpenClaw gateway token is read from `~/.openclaw/openclaw.json` and
  sent only to the local gateway.
- Credentials are written under `~/.openclaw/credentials/aicoo/creds.json`.

## Operational Notes

### Keep The Relay Running

The local relay process must stay alive:

```bash
npx aicooclaw-systemind@latest relay
```

If it is stopped, Aicoo can enqueue messages but cannot receive local OpenClaw
responses.

### Token Expiration

Pairing tokens are short-lived. If approval fails or expires, rerun:

```bash
npx aicooclaw-systemind@latest install
```

### Direct Public Endpoint Mode

If OpenClaw is exposed through a real public URL, the CLI can register that URL:

```bash
npx aicooclaw-systemind@latest install \
  --api-endpoint https://openclaw.example.com/v1/chat/completions
```

In that case Aicoo may call the endpoint directly. For `localhost` endpoints,
relay mode is required.

## Build And Release

Build locally:

```bash
npm run build
```

Release:

```bash
npm version patch --no-git-tag-version
npm publish --access public
```

The package publishes:

- `dist/`
- `openclaw.plugin.json`

## Current Known Limitations

- The relay requires a foreground terminal process.
- Streaming responses are not relayed yet; requests use `stream: false`.
- The relay currently handles text chat only.
- If OpenClaw gateway is not running, the user will see a relay/OpenClaw request
  failure in Aicoo.
