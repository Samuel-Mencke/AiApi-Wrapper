# Model Console

Self-hosted OpenAI-compatible model API with provider routing, model aliases, fallbacks, usage tracking, API-key management, audio transcription, agent tools, and a web administration console.

The repository contains two applications and one shared package:

- `apps/api`: Fastify API on port `18789`
- `apps/web`: Next.js administration console on port `3000`
- `packages/core`: shared request, response, pricing, and provider types

The service exposes Chat Completions and Responses endpoints that can be used by OpenAI-compatible SDKs and coding clients. The browser console is separate from the public model API and authenticates with a signed HTTP-only session cookie.

## Core capabilities

- OpenAI-compatible `POST /v1/chat/completions`
- OpenAI-compatible `POST /v1/responses`, stored responses, cancellation, and input items
- `GET /v1/models` model discovery
- Provider and model management through YAML and the web console
- Ordered fallback routes
- Streaming through Server-Sent Events
- API-key creation, disabling, expiry, and monthly request limits
- Request metadata, latency, token, cost, and provider statistics
- Audio transcription endpoint
- OpenAPI and agent discovery documents
- SQLite persistence
- Docker Compose deployment
- Cloudflare Tunnel examples for custom domains
- A GitHub Actions verification template for secrets, types, lint, and production builds

## Security contract

The following files are local runtime state and must never be committed:

- `.env`
- `config/providers.yml`
- `data/`
- SQLite databases and WAL files
- Cloudflare credentials and tunnel tokens
- private keys, local backups, and UI snapshots

Only these templates belong in Git:

- `.env.example`
- `config/providers.example.yml`
- `deploy/cloudflared/config.example.yml`

The repository includes `pnpm check:secrets`. The same verification workflow is provided as `deploy/github-actions/verify.yml`; copy it to `.github/workflows/verify.yml` when the GitHub credential used for the change has workflow permission. The scanner rejects tracked environment files, production provider configuration, databases, private keys, backup files, and common high-confidence token formats.

Provider credentials are read only from server-side environment variables. They are never returned by the administration API or embedded in the web application.

## Prerequisites

For Docker deployment:

- Linux server
- Git
- Docker Engine with the Compose plugin
- A domain on Cloudflare only when public custom domains are required

For local development:

- Node.js 22 or 24
- Corepack
- pnpm 9.15.4, selected from `packageManager` in `package.json`

## Quick start with Docker

### 1. Clone and prepare local files

```bash
git clone https://github.com/Samuel-Mencke/AiApi-Wrapper.git
cd AiApi-Wrapper

cp .env.example .env
cp config/providers.example.yml config/providers.yml
mkdir -p data/uploads
chmod 600 .env
```

`config/providers.yml` remains on the server and is ignored by Git.

### 2. Generate required secrets

Generate the master API key and the admin session secret:

```bash
openssl rand -hex 32
openssl rand -hex 32
```

Put the first value in `MASTER_API_KEY` and the second value in `ADMIN_SESSION_SECRET` inside `.env`.

Generate the admin password hash without storing the plaintext password in the repository:

```bash
corepack enable
pnpm install --frozen-lockfile

read -rsp "Admin password: " ADMIN_PASSWORD
echo
printf '%s' "$ADMIN_PASSWORD" | pnpm admin:hash-password
unset ADMIN_PASSWORD
```

Copy the resulting `pbkdf2_sha256$...` value into `ADMIN_PASSWORD_HASH` in `.env`.

Required production values:

```dotenv
MASTER_API_KEY=<random value with at least 32 characters>
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=<output from pnpm admin:hash-password>
ADMIN_SESSION_SECRET=<random value with at least 32 characters>
```

The API intentionally refuses to start when these values are missing, too short, malformed, or still contain placeholder wording.

### 3. Configure at least one provider and model

Edit `.env` and add only the credentials you use. Then edit `config/providers.yml` and enable the matching provider and model alias.

Example for OpenAI:

```dotenv
OPENAI_API_KEY=<provider key>
```

```yaml
providers:
  openai:
    type: openai
    enabled: true

models:
  default:
    provider: openai
    model: gpt-4.1-mini
    enabled: true
```

Example for a local OpenAI-compatible server such as Ollama, vLLM, or LocalAI:

```yaml
providers:
  local:
    type: custom
    baseUrl: http://host.docker.internal:11434/v1
    enabled: true

models:
  local-default:
    provider: local
    model: llama-local
    context_length: 8192
    max_output_tokens: 2048
    enabled: true
```

The Compose file maps `host.docker.internal` to the Linux host gateway.

### 4. Start the service

```bash
docker compose up -d --build
```

Check the containers and health endpoint:

```bash
docker compose ps
curl --fail http://127.0.0.1:18789/health
```

Open the console at:

```text
http://localhost:3000/login
```

The API listens on `127.0.0.1` by default through Docker port publishing. It is not directly exposed on every network interface. A reverse proxy or Cloudflare Tunnel should publish it.

## Local development

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
cp config/providers.example.yml config/providers.yml
mkdir -p data/uploads
```

Generate the three required authentication values as described above, then run:

```bash
pnpm dev
```

Default addresses:

- API: `http://localhost:18789`
- Console: `http://localhost:3000`

Validation commands:

```bash
pnpm check:secrets
pnpm typecheck
pnpm lint
pnpm build
```

Run the complete verification sequence with:

```bash
pnpm check
```

## Native systemd deployment

For a native Node.js deployment without Docker, use the included user-service templates and the complete guide in [`docs/systemd.md`](docs/systemd.md). It covers loopback binding, builds, service installation, manual updates, rollback behavior, and the optional verified Git deployment timer.

## Environment reference

### Required authentication values

| Variable | Purpose |
| --- | --- |
| `MASTER_API_KEY` | Full-access Bearer key for public model endpoints. Minimum 32 characters. |
| `ADMIN_USERNAME` | Username for the web console. Default example is `admin`. |
| `ADMIN_PASSWORD_HASH` | PBKDF2-SHA256 hash generated by `pnpm admin:hash-password`. |
| `ADMIN_SESSION_SECRET` | HMAC secret for signed admin session cookies. Minimum 32 characters. |

### Network and public URL values

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Bind address inside the API process or container. |
| `PORT` | `18789` | Host-side API port. Docker keeps the container port at `18789`. |
| `DASHBOARD_PORT` | `3000` | Host-side console port. |
| `PUBLIC_BASE_URL` | `http://localhost:18789` | Public API origin without a trailing `/v1`. Used by metadata and secure-cookie decisions. |
| `NEXT_PUBLIC_PUBLIC_API_URL` | `http://localhost:18789` | Public API origin shown in documentation and generated client examples. This value is compiled into the browser bundle. |
| `API_BACKEND_URL` | `http://127.0.0.1:18789` | Private server-side target used by Next.js for same-origin `/api/*` proxying. Docker sets this to `http://api:18789`. |
| `NEXT_PUBLIC_CHAT_URL` | empty | Optional external chat application URL. The navigation entry is hidden when empty. |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated exact browser origins allowed to send credentialed requests. Do not use `*`. |
| `ADMIN_COOKIE_DOMAIN` | empty | Optional cookie domain. Keep empty with the built-in same-origin `/api` proxy. Set a parent domain only for a deliberate direct cross-subdomain browser architecture. |
| `SERVICE_NAME` | `model-api` | Neutral name returned by `/health`. |

### Storage and configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `file:./data/gateway.db` | SQLite URL. Docker overrides this to `file:/data/gateway.db`. |
| `UPLOAD_DIR` | `data/uploads` | Attachment and transcription upload directory. Docker overrides this to `/data/uploads`. |
| `CONFIG_PATH` | `config/providers.yml` | Local provider and model configuration. |
| `ENABLE_PROMPT_LOGGING` | `false` | When `false`, request metadata can be stored without prompt or response bodies. Keep this disabled unless content logging is explicitly required. |

### Provider credentials

Built-in provider names use these variables:

| Provider name | Environment variable |
| --- | --- |
| `openai` | `OPENAI_API_KEY` |
| `anthropic` | `ANTHROPIC_API_KEY` |
| `gemini` | `GEMINI_API_KEY` |
| `openrouter` | `OPENROUTER_API_KEY` |
| `z-ai` | `ZAI_API_KEY` |

For any custom provider, set `apiKeyEnv` in `config/providers.yml`:

```yaml
providers:
  vendor:
    type: custom
    baseUrl: https://provider.example.com/v1
    apiKeyEnv: VENDOR_API_KEY
    enabled: true
```

Then add this only to `.env`:

```dotenv
VENDOR_API_KEY=<provider credential>
```

When `apiKeyEnv` is omitted, the service also checks a conventional name derived from the provider ID. For example, `my-provider` maps to `MY_PROVIDER_API_KEY`.

## Provider and model configuration

The production file is `config/providers.yml`. It has two top-level sections:

```yaml
providers: {}
models: {}
```

A provider entry supports:

```yaml
providers:
  provider-id:
    type: custom
    baseUrl: https://provider.example.com/v1
    apiKeyEnv: PROVIDER_API_KEY
    enabled: true
```

Supported provider types:

- `openai`
- `openrouter`
- `gemini`
- `anthropic`
- `custom`
- `chatgpt-web`

A model alias supports:

```yaml
models:
  coding:
    provider: provider-id
    model: upstream-model-id
    enabled: true
    context_length: 131072
    max_output_tokens: 16384
    fallback:
      - provider: second-provider
        model: second-upstream-model
      - provider: third-provider
        model: third-upstream-model
```

Clients use the alias `coding`; the upstream provider receives `upstream-model-id`.

On API startup, YAML providers and aliases are synchronized into SQLite. Existing YAML-managed provider definitions and model aliases are updated. Entries created only in the web console remain in SQLite.

After editing YAML, restart the API:

```bash
docker compose restart api
```

Never put a credential directly in YAML.

## Authentication model

### Public model API

Send one of these values as a Bearer token:

- `MASTER_API_KEY`
- an API key generated in the web console

```http
Authorization: Bearer <key>
```

Generated API keys are SHA-256 hashed before storage. The plaintext value should be copied into the intended client immediately and then treated as unrecoverable secret material.

### Web console

The console calls `/admin/login`. A successful login creates a signed, HTTP-only, `SameSite=Lax` session cookie. HTTPS deployments add the `Secure` attribute.

For the recommended separate public hostnames with the built-in same-origin console proxy:

```dotenv
PUBLIC_BASE_URL=https://api.example.com
NEXT_PUBLIC_PUBLIC_API_URL=https://api.example.com
API_BACKEND_URL=http://127.0.0.1:18789
CORS_ORIGINS=https://console.example.com
ADMIN_COOKIE_DOMAIN=
```

Leave `ADMIN_COOKIE_DOMAIN` empty with the default console proxy. Set it to a parent domain only when the browser intentionally calls the API origin directly and must share the admin cookie across subdomains.

## Public endpoints

Unauthenticated:

- `GET /health`
- `GET /.well-known/openapi.json`
- `GET /v1/openapi.json`
- `GET /.well-known/ai-plugin.json`

Bearer authentication required:

- `GET /v1/models`
- `GET /v1/models/:model`
- `POST /v1/chat/completions`
- `POST /v1/responses`
- `GET /v1/responses/:response_id`
- `DELETE /v1/responses/:response_id`
- `POST /v1/responses/:response_id/cancel`
- `GET /v1/responses/:response_id/input_items`
- `POST /v1/audio/transcriptions`

Administration routes under `/admin/*` require the signed console session, except login and session discovery.

All API responses include an `x-request-id`. Errors use an OpenAI-style JSON error object.

## Chat Completions example

```bash
curl https://api.example.com/v1/chat/completions \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "coding",
    "messages": [
      {"role": "user", "content": "Write a TypeScript debounce function."}
    ],
    "stream": false
  }'
```

Streaming request:

```bash
curl --no-buffer https://api.example.com/v1/chat/completions \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "coding",
    "messages": [{"role": "user", "content": "Explain this repository."}],
    "stream": true
  }'
```

## Responses API example

```bash
curl https://api.example.com/v1/responses \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "coding",
    "instructions": "Be precise and return valid TypeScript.",
    "input": "Create a retry helper with exponential backoff.",
    "stream": false,
    "store": true
  }'
```

## Audio transcription example

```bash
curl https://api.example.com/v1/audio/transcriptions \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -F 'file=@recording.webm' \
  -F 'language=de' \
  -F 'response_format=json'
```

The default upload limit is 15 MB.

## OpenAI JavaScript client

```bash
npm install openai
```

```ts
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.MODEL_API_KEY,
  baseURL: "https://api.example.com/v1"
});

const result = await client.chat.completions.create({
  model: "coding",
  messages: [{ role: "user", content: "Return a JSON object." }]
});

console.log(result.choices[0]?.message.content);
```

## OpenAI Python client

```bash
pip install openai
```

```python
import os
from openai import OpenAI

client = OpenAI(
    api_key=os.environ["MODEL_API_KEY"],
    base_url="https://api.example.com/v1",
)

response = client.chat.completions.create(
    model="coding",
    messages=[{"role": "user", "content": "Summarize this error."}],
)

print(response.choices[0].message.content)
```

Many compatible clients can be configured with:

```dotenv
OPENAI_BASE_URL=https://api.example.com/v1
OPENAI_API_KEY=<generated service key>
```

Some clients call the setting `OPENAI_API_BASE` or `base_url`. Their base URL must end in `/v1` unless that client appends `/v1` itself.

## Instructions for automated agents

An agent integrating this service should follow this deterministic sequence:

1. Fetch `GET /.well-known/openapi.json` from the configured API origin.
2. Check `GET /health` without authentication.
3. Send `Authorization: Bearer <key>` for model operations.
4. Fetch `GET /v1/models` and use an advertised model alias exactly as returned.
5. Prefer `POST /v1/responses` when the client supports Responses API tools; otherwise use `POST /v1/chat/completions`.
6. Set `stream: true` only when the client processes Server-Sent Events incrementally.
7. Preserve `x-request-id` in error reports.
8. Never write keys, `.env`, provider credentials, cookies, prompts, responses, or database files into Git.
9. Before proposing a deployment, run `pnpm check` and verify `/health` after restart.
10. When changing public domains, update `PUBLIC_BASE_URL`, `NEXT_PUBLIC_PUBLIC_API_URL`, `CORS_ORIGINS`, and any optional `NEXT_PUBLIC_CHAT_URL`; then rebuild the web image. Keep `API_BACKEND_URL` pointed at the private API service.

## Custom domains with Cloudflare Tunnel

The recommended layout uses separate hostnames:

- `console.example.com` -> `http://127.0.0.1:3000`
- `api.example.com` -> `http://127.0.0.1:18789`

Set:

```dotenv
PUBLIC_BASE_URL=https://api.example.com
NEXT_PUBLIC_PUBLIC_API_URL=https://api.example.com
API_BACKEND_URL=http://127.0.0.1:18789
CORS_ORIGINS=https://console.example.com
ADMIN_COOKIE_DOMAIN=
```

Use a comma-separated list when multiple console origins are required:

```dotenv
CORS_ORIGINS=https://console.example.com,https://staging-console.example.com
```

### Option A: remotely managed tunnel in Docker

1. In Cloudflare, open **Networking -> Tunnels** and create a tunnel.
2. Add two published application routes:
   - `console.example.com` to `http://localhost:3000`
   - `api.example.com` to `http://localhost:18789`
3. Select the Docker connector and copy only the tunnel token into local `.env`:

```dotenv
CLOUDFLARE_TUNNEL_TOKEN=<tunnel token>
```

4. Start the application and connector:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.cloudflare.yml \
  up -d --build
```

The connector uses host networking so that the dashboard-defined `localhost` origins resolve to the server's loopback-bound services.

Verify:

```bash
curl --fail https://api.example.com/health
curl --fail https://api.example.com/.well-known/openapi.json
```

### Option B: locally managed tunnel with a host service

Authenticate and create the tunnel:

```bash
cloudflared tunnel login
cloudflared tunnel create model-console
```

Copy the template outside the repository:

```bash
mkdir -p ~/.cloudflared
cp deploy/cloudflared/config.example.yml ~/.cloudflared/config.yml
chmod 600 ~/.cloudflared/config.yml ~/.cloudflared/*.json
```

Replace `TUNNEL_UUID`, `USER`, and both hostnames. The final rule must remain the catch-all `http_status:404` rule.

Create DNS routes:

```bash
cloudflared tunnel route dns model-console console.example.com
cloudflared tunnel route dns model-console api.example.com
```

Validate routing before installing the service:

```bash
cloudflared tunnel ingress validate
cloudflared tunnel ingress rule https://console.example.com
cloudflared tunnel ingress rule https://api.example.com/health
```

Install and start the Linux service:

```bash
sudo cloudflared --config "$HOME/.cloudflared/config.yml" service install
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared --no-pager
```

For an existing locally managed tunnel, add the two ingress entries, create the DNS routes, validate the rules, and restart `cloudflared`.

### Cloudflare security settings

- Protect the console hostname with Cloudflare Access when possible.
- Do not put an interactive Access login in front of the API hostname unless every API client supports it.
- Use service tokens or mTLS for machine-only API restrictions when required.
- Disable caching for `/v1/*`, `/admin/*`, `/health`, and discovery JSON.
- Keep the origin ports bound to `127.0.0.1`.
- Do not enable `noTLSVerify` for the provided local HTTP origins; TLS verification is not involved between `cloudflared` and an `http://127.0.0.1` service.
- Tunnel tokens are credentials. Store them only in `.env` or a protected external secret store.

Current Cloudflare documentation:

- https://developers.cloudflare.com/tunnel/setup/
- https://developers.cloudflare.com/tunnel/advanced/local-management/configuration-file/
- https://developers.cloudflare.com/tunnel/advanced/local-management/tunnel-useful-commands/

## Custom domains with Caddy

`Caddyfile` contains a two-host reverse-proxy example. Set the domains and run Caddy on the host:

```bash
export DASHBOARD_DOMAIN=console.example.com
export API_DOMAIN=api.example.com
caddy run --config ./Caddyfile
```

The application containers remain bound to loopback. Caddy handles public HTTPS and forwards to ports `3000` and `18789`.

Do not run Caddy and Cloudflare Tunnel as competing public entry points unless that topology is intentional.

## Updating a production deployment

The ignored `.env`, `config/providers.yml`, and Docker volume survive normal Git updates.

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
pnpm install --frozen-lockfile
pnpm check
docker compose up -d --build
curl --fail http://127.0.0.1:18789/health
```

When using the Docker tunnel overlay:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.cloudflare.yml \
  up -d --build
```

Never deploy from a dirty working tree. Commit intended source changes first; keep runtime configuration ignored.

## Logs and diagnostics

```bash
docker compose ps
docker compose logs --tail=200 api
docker compose logs --tail=200 web
curl -i http://127.0.0.1:18789/health
curl -i http://127.0.0.1:3000/login
```

Cloudflare connector diagnostics:

```bash
cloudflared --version
cloudflared tunnel info model-console
sudo journalctl -u cloudflared -n 200 --no-pager
```

### `401 API key required`

The route requires:

```http
Authorization: Bearer <MASTER_API_KEY or generated key>
```

Do not use a provider credential as the service Bearer key.

### Console login succeeds locally but not through custom domains

Check all four values together:

```dotenv
PUBLIC_BASE_URL=https://api.example.com
NEXT_PUBLIC_PUBLIC_API_URL=https://api.example.com
API_BACKEND_URL=http://127.0.0.1:18789
CORS_ORIGINS=https://console.example.com
ADMIN_COOKIE_DOMAIN=
```

Then rebuild the web image because `NEXT_PUBLIC_PUBLIC_API_URL` is compiled into the client bundle:

```bash
docker compose up -d --build web api
```

### CORS rejection

`CORS_ORIGINS` must contain the exact scheme and host from the browser address bar. Paths and trailing slashes do not belong in the value.

### Provider returns `401`

Confirm:

1. the provider is enabled;
2. the model alias references that provider ID;
3. the correct environment variable is present in `.env`;
4. custom providers use `apiKeyEnv` or the conventional `<PROVIDER_ID>_API_KEY` name;
5. the API was restarted after changing `.env` or YAML.

### Local provider is unreachable from Docker

Use `host.docker.internal` instead of `localhost` in `config/providers.yml`. Inside the API container, `localhost` points back to that container.

### Cloudflare error `1016`

The DNS route exists but no active tunnel connector currently serves it. Check the connector container or `cloudflared` system service.

### Cloudflare reports origin unavailable

Confirm the local service first:

```bash
curl --fail http://127.0.0.1:18789/health
curl --fail http://127.0.0.1:3000/login
```

Then verify that the published application route points to the correct local port.

## Backup and restore

Back up these items:

- `.env`
- `config/providers.yml`
- SQLite data volume

Stop the API before copying SQLite directly:

```bash
mkdir -p backups
docker compose stop api
docker compose cp api:/data/gateway.db ./backups/gateway.db
docker compose start api
```

Restore:

```bash
docker compose stop api
docker compose cp ./backups/gateway.db api:/data/gateway.db
docker compose start api
curl --fail http://127.0.0.1:18789/health
```

Protect backups with permissions and encryption. They can contain hashed client keys, usage metadata, settings, and stored responses.

## Repository checks before pushing

```bash
git status --short
pnpm check:secrets
pnpm typecheck
pnpm lint
pnpm build
git diff --check
```

Review the staged file list before every commit:

```bash
git diff --cached --name-only
```

The list must not contain `.env`, `config/providers.yml`, `data/`, databases, Cloudflare credentials, private keys, or local backups.
