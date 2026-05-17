# aicooclaw-systemind

`aicooclaw-systemind` connects a local **OpenClaw** gateway to **Aicoo**.

It is designed for the common case where OpenClaw is running on your laptop at
`localhost:18789` and Aicoo is running in the cloud at `https://www.aicoo.io`.
Because Aicoo cannot directly fetch your laptop's `localhost`, the package uses
a lightweight relay loop:

1. Aicoo stores user messages in a short-lived Upstash Redis relay queue.
2. The local CLI polls Aicoo for pending work.
3. The CLI forwards each request to the local OpenClaw chat completions endpoint.
4. The CLI posts the OpenClaw response back to Aicoo.

## Quick Start

Start the OpenClaw gateway:

```bash
openclaw gateway
```

In another terminal, connect Aicoo:

```bash
npx aicooclaw-systemind@latest install
```

Open the pairing URL shown in the terminal, approve the request in a signed-in
Aicoo browser session, then keep the terminal open. After approval, the CLI
enters relay mode automatically.

## Running The Relay Later

If pairing has already been completed, start the relay directly:

```bash
npx aicooclaw-systemind@latest relay
```

Keep this process running while chatting with OpenClaw from Aicoo.

## Commands

```bash
npx aicooclaw-systemind@latest install
npx aicooclaw-systemind@latest relay
```

`install`:

- detects OpenClaw
- reads `~/.openclaw/openclaw.json`
- enables `gateway.http.endpoints.chatCompletions`
- creates a pairing session on Aicoo
- displays a QR code and pair URL
- saves Aicoo credentials after approval
- starts the relay loop

`relay`:

- reads saved credentials from `~/.openclaw/credentials/aicoo/creds.json`
- polls Aicoo for pending relay requests
- calls the local OpenClaw endpoint
- posts responses back to Aicoo

## Options

```bash
npx aicooclaw-systemind@latest install \
  --url https://www.aicoo.io \
  --api-endpoint http://localhost:18789/v1/chat/completions
```

Available flags:

- `--url <url>`: Aicoo base URL. Defaults to `https://www.aicoo.io`.
- `--api-endpoint <url>`: OpenClaw chat completions endpoint. Defaults to `http://localhost:<gateway-port>/v1/chat/completions`.
- `--open`: automatically open the pair URL in the default browser.
- `--api-key <key>`: skip browser pairing and save credentials directly.
- `--sub-agent-id <id>`: optional manual sub-agent id for direct credential setup.
- `--conversation-id <id>`: optional manual conversation id for direct credential setup.

## Files Written

The installer may update:

```text
~/.openclaw/openclaw.json
```

It saves Aicoo credentials to:

```text
~/.openclaw/credentials/aicoo/creds.json
```

Example credential shape:

```json
{
  "apiKey": "aicoo_sk_live_...",
  "baseUrl": "https://www.aicoo.io",
  "subAgentId": 123,
  "conversationId": 456,
  "pollIntervalMs": 3000,
  "enabled": true
}
```

## Requirements

- Node.js 20+
- OpenClaw installed and available as `openclaw`
- OpenClaw gateway running locally when using the relay
- Aicoo account signed in at `https://www.aicoo.io`

## Troubleshooting

### `Failed to reach sub-agent: fetch failed`

This usually means Aicoo tried to call a `localhost` endpoint directly. Use
version `0.1.5` or newer and run:

```bash
npx aicooclaw-systemind@latest relay
```

### Pairing waits forever

Run `install` again to generate a fresh token:

```bash
npx aicooclaw-systemind@latest install
```

Pairing tokens are short-lived. Open the URL in a browser profile that is signed
in to Aicoo.

### OpenClaw returns an auth error

Check the gateway token in:

```text
~/.openclaw/openclaw.json
```

The CLI reads `gateway.auth.token` and sends it as a bearer token when calling
the local OpenClaw endpoint.

### Old Pulse credentials still exist

This package uses:

```text
~/.openclaw/credentials/aicoo/creds.json
```

Old files under `~/.openclaw/credentials/pulse/` are not used by this package.

## Development

Install dependencies:

```bash
npm install
```

Build:

```bash
npm run build
```

Watch mode:

```bash
npm run dev
```

Publish:

```bash
npm version patch --no-git-tag-version
npm publish --access public
```

## Package Contents

The npm package publishes:

- `dist/`
- `openclaw.plugin.json`

## Technical Documentation

See [TECHNICAL.md](./TECHNICAL.md) for architecture, API contracts, data flow,
and implementation notes.

## License

MIT
