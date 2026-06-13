# ai-gateway

`ai-gateway` is a self-hosted AI API gateway that exposes configured providers through an OpenAI-compatible Chat Completions and Responses API plus a local admin dashboard.

## Setup

Use Node 22 LTS or Node 24 for local development. The Docker images use Node 22.

Install pnpm, then copy the example files:

```bash
corepack enable
cp .env.example .env
cp providers.example.yml config/providers.yml
pnpm install
```

Add provider keys only for providers you enable. The dashboard runs in personal mode and does not require a login token.

## Environment

Important `.env` values:

- `HOST=0.0.0.0` binds the API to LAN interfaces.
- `PORT=18789` exposes the API.
- `PUBLIC_BASE_URL=http://localhost:18789` is used by docs, reverse proxy, and dashboard config display.
- `DASHBOARD_PORT=3000` runs the Next.js dashboard.
- `DATABASE_URL=file:./gateway.db` stores SQLite locally.
- `GATEWAY_MASTER_KEY` is optional legacy compatibility. The local dashboard does not require it.

Provider API keys are never sent to the frontend.

## Provider Config

Edit `config/providers.yml` to define providers and model aliases:

```yaml
models:
  glm5.1:
    provider: z-ai
    model: glm-5.1
```

The API syncs new YAML providers and routes into SQLite on startup. Admin-created routes live in SQLite.

## Running Locally

```bash
pnpm dev
```

API: `http://localhost:18789`

Dashboard: `http://localhost:3000`

Open the dashboard and create gateway API keys if you want keys for external clients. Local API calls can also be made without a gateway key.

## Running With Docker

```bash
docker compose up --build
```

The compose file mounts `config/providers.yml` and persists SQLite data in the `gateway-data` volume.

## OpenAI-Compatible API

Implemented public endpoints:

- `GET /health`
- `GET /v1/models`
- `GET /v1/models/:model`
- `POST /v1/chat/completions`
- `POST /v1/responses`
- `GET /v1/responses/:response_id`
- `DELETE /v1/responses/:response_id`
- `POST /v1/responses/:response_id/cancel`
- `GET /v1/responses/:response_id/input_items`

The gateway uses OpenAI-style error objects and attaches `x-request-id` to API responses.

## Example Requests

```bash
curl http://localhost:18789/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer gw_your_key" \
  -d '{
    "model": "glm5.1",
    "messages": [
      { "role": "user", "content": "Write a simple TypeScript function." }
    ],
    "stream": false
  }'
```

Streaming works for OpenAI-compatible providers:

```json
{ "model": "glm5.1", "messages": [{ "role": "user", "content": "Hello" }], "stream": true }
```

Responses API requests work for Codex-style clients:

```bash
curl http://localhost:18789/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer gw_your_key" \
  -d '{
    "model": "glm5-turbo",
    "instructions": "You are a coding assistant.",
    "input": "Inspect this error and suggest a fix.",
    "stream": false
  }'
```

Responses streaming emits typed `response.*` server-sent events. Stored responses can be retrieved by ID unless `store` is explicitly set to `false`.

## Adding A Provider

1. Add the provider to `config/providers.yml`.
2. If it is OpenAI-compatible, set `type: custom` and provide `baseUrl`.
3. Add a model alias under `models`.
4. Restart the API.

For native providers, add a new adapter under `apps/api/src/providers`, register it in the fallback router, and keep request/response normalization isolated.

## Security Notes

- Gateway API keys are SHA-256 hashed before storage.
- Provider API keys are read from server-side environment variables only.
- Logs store metadata only by default and do not persist prompts or responses.
- Personal mode is intended for local/LAN use. Put the gateway behind your own network controls before exposing it publicly.
- Use HTTPS and a reverse proxy such as Caddy for custom domains.
