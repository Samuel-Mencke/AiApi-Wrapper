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
- Agent-oriented deployment, migration, key-provisioning, and verification templates

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
- `deploy/agents/*.example`

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

## Agent-first deployment

This repository is designed to be installed or maintained by autonomous agents such as Hermes Agent, OpenClaw, Codex-style coding agents, and general server-operation agents. The complete runbook is [`docs/agent-server-deployment.md`](docs/agent-server-deployment.md), and repository-specific operating rules are in [`AGENTS.md`](AGENTS.md).

Use this decision table before making changes:

| Starting state                           | Required approach                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| Empty server                             | Follow the fresh Docker or systemd installation                                            |
| Existing installation of this repository | Back up `.env`, YAML, SQLite, uploads, services, and routing; then upgrade                 |
| Existing unrelated API gateway           | Install side by side and recreate providers, aliases, and client keys                      |
| Existing Hermes or OpenClaw              | Merge only the custom provider and model settings; preserve all other client configuration |
| Zero-change client cutover               | Preserve the public hostname, Bearer key, and model alias                                  |

An automated agent must not stop an existing gateway until all of these pass against a staged instance:

1. `GET /health`;
2. authenticated `GET /v1/models`;
3. the expected model alias is advertised;
4. a real `POST /v1/chat/completions` request succeeds;
5. the target Hermes, OpenClaw, or generic client completes a real turn;
6. rollback routing and service commands are recorded.

Reusable client templates:

- `deploy/agents/hermes.env.example`
- `deploy/agents/hermes.config.example.yaml`
- `deploy/agents/openclaw.env.example`
- `deploy/agents/openclaw.config.example.json5`
- `deploy/agents/generic-openai.env.example`

Operational helpers:

- `scripts/create-agent-api-key.sh`: creates one dedicated generated key and writes a protected client environment file without printing the key;
- `scripts/verify-agent-api.sh`: checks health, model discovery, model presence, authentication, and a real inference request.

Recommended production topology:

```text
Hermes / OpenClaw / other agents
            |
            | HTTPS + Bearer key
            v
https://api.example.com/v1
            |
   Cloudflare Tunnel / Caddy
            |
     127.0.0.1:18789
            |
     provider routing + fallbacks
```

The web console is a separate hostname and listener:

```text
https://console.example.com -> 127.0.0.1:3000
```

Keep the API and console origin ports bound to loopback. Do not expose port `18789` directly to the public internet merely to make an agent connection easier.

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

| Variable               | Purpose                                                                   |
| ---------------------- | ------------------------------------------------------------------------- |
| `MASTER_API_KEY`       | Full-access Bearer key for public model endpoints. Minimum 32 characters. |
| `ADMIN_USERNAME`       | Username for the web console. Default example is `admin`.                 |
| `ADMIN_PASSWORD_HASH`  | PBKDF2-SHA256 hash generated by `pnpm admin:hash-password`.               |
| `ADMIN_SESSION_SECRET` | HMAC secret for signed admin session cookies. Minimum 32 characters.      |

### Network and public URL values

| Variable                     | Default                  | Purpose                                                                                                                                                               |
| ---------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HOST`                       | `0.0.0.0`                | Bind address inside the API process or container.                                                                                                                     |
| `PORT`                       | `18789`                  | Host-side API port. Docker keeps the container port at `18789`.                                                                                                       |
| `DASHBOARD_PORT`             | `3000`                   | Host-side console port.                                                                                                                                               |
| `PUBLIC_BASE_URL`            | `http://localhost:18789` | Public API origin without a trailing `/v1`. Used by metadata and secure-cookie decisions.                                                                             |
| `NEXT_PUBLIC_PUBLIC_API_URL` | `http://localhost:18789` | Public API origin shown in documentation and generated client examples. This value is compiled into the browser bundle.                                               |
| `API_BACKEND_URL`            | `http://127.0.0.1:18789` | Private server-side target used by Next.js for same-origin `/api/*` proxying. Docker sets this to `http://api:18789`.                                                 |
| `NEXT_PUBLIC_CHAT_URL`       | empty                    | Optional external chat application URL. The navigation entry is hidden when empty.                                                                                    |
| `CORS_ORIGINS`               | `http://localhost:3000`  | Comma-separated exact browser origins allowed to send credentialed requests. Do not use `*`.                                                                          |
| `ADMIN_COOKIE_DOMAIN`        | empty                    | Optional cookie domain. Keep empty with the built-in same-origin `/api` proxy. Set a parent domain only for a deliberate direct cross-subdomain browser architecture. |
| `SERVICE_NAME`               | `model-api`              | Neutral name returned by `/health`.                                                                                                                                   |

### Storage and configuration

| Variable                | Default                  | Purpose                                                                                                                                           |
| ----------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`          | `file:./data/gateway.db` | SQLite URL. Docker overrides this to `file:/data/gateway.db`.                                                                                     |
| `UPLOAD_DIR`            | `data/uploads`           | Attachment and transcription upload directory. Docker overrides this to `/data/uploads`.                                                          |
| `CONFIG_PATH`           | `config/providers.yml`   | Local provider and model configuration.                                                                                                           |
| `ENABLE_PROMPT_LOGGING` | `false`                  | When `false`, request metadata can be stored without prompt or response bodies. Keep this disabled unless content logging is explicitly required. |

### Provider credentials

Built-in provider names use these variables:

| Provider name | Environment variable |
| ------------- | -------------------- |
| `openai`      | `OPENAI_API_KEY`     |
| `anthropic`   | `ANTHROPIC_API_KEY`  |
| `gemini`      | `GEMINI_API_KEY`     |
| `openrouter`  | `OPENROUTER_API_KEY` |
| `z-ai`        | `ZAI_API_KEY`        |

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
  baseURL: "https://api.example.com/v1",
});

const result = await client.chat.completions.create({
  model: "coding",
  messages: [{ role: "user", content: "Return a JSON object." }],
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

## Automated agents, client setup, and gateway replacement

The full deployment and migration procedure is in [`docs/agent-server-deployment.md`](docs/agent-server-deployment.md). The following section contains the complete minimum sequence an autonomous agent should follow.

### Deterministic operator sequence

1. Read `AGENTS.md`, this README, `.env.example`, `config/providers.example.yml`, and the relevant deployment guide.
2. Inventory listeners, containers, systemd units, repository paths, databases, public domains, reverse proxies, tunnels, model names, and client configuration.
3. Back up the existing application, runtime configuration, SQLite data, agent configuration, and public routing before editing or stopping anything.
4. Install the new service in a stable path and use alternate local ports for side-by-side staging when replacing a live gateway.
5. Keep credentials in environment files and provider/model routing in `config/providers.yml`.
6. Preserve the old public API hostname, client key, and model alias when clients must continue without configuration changes.
7. Validate local health, authenticated model discovery, and a real inference request.
8. Create a dedicated generated API key per agent instead of sharing `MASTER_API_KEY`.
9. Merge Hermes or OpenClaw settings without overwriting unrelated tools, channels, memory, skills, or security policy.
10. Test from the same host and network route the real agent uses.
11. Cut over the reverse proxy or tunnel only after staging succeeds.
12. Keep the old gateway available for rollback until post-cutover acceptance is complete.
13. Run repository validation, commit only tracked source/templates, and verify that secrets remain outside Git.

### Inventory before replacing an existing gateway

Use non-destructive discovery commands first:

```bash
uname -a
id
ss -ltnp
systemctl --user list-units --type=service --all
systemctl list-units --type=service --all \
  | grep -Ei 'gateway|model|openclaw|hermes|cloudflared|caddy' || true
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}'
```

Find likely configuration files without printing their contents:

```bash
find "$HOME" -maxdepth 4 -type f \
  \( -name '.env' -o -name 'providers.yml' -o -name 'openclaw.json' -o -name 'config.yaml' -o -name '*.service' \) \
  -print 2>/dev/null
```

List only environment variable names when inspecting a secret file:

```bash
awk -F= '/^[A-Z][A-Z0-9_]*=/ { print $1"=<set>" }' /path/to/.env
```

Record the current API base URL, model aliases, key distribution, origin ports, DNS names, tunnel routes, service names, data paths, and rollback owner.

### Backup before replacement

Store backups outside the repository with restrictive permissions:

```bash
backup_root="$HOME/backups/model-console/$(date +%Y%m%d-%H%M%S)"
install -d -m 700 "$backup_root"

cp -a /path/to/old/.env "$backup_root/old.env"
cp -a /path/to/old/providers.yml "$backup_root/old-providers.yml" 2>/dev/null || true
systemctl --user cat old-service.service >"$backup_root/old-service.unit" 2>/dev/null || true
chmod -R go-rwx "$backup_root"
find "$backup_root" -type f -exec sha256sum {} + >"$backup_root/SHA256SUMS"
```

Stop a SQLite-writing process before directly copying its database. Do not import an unrelated gateway's database into this application.

### Side-by-side staging

For Docker, stage on alternate host ports while the old service remains active:

```bash
PORT=18790 DASHBOARD_PORT=3001 \
  docker compose -p model-console-staging up -d --build

curl --fail http://127.0.0.1:18790/health
curl --fail http://127.0.0.1:3001/login >/dev/null
```

Test model discovery and inference against staging:

```bash
curl --fail http://127.0.0.1:18790/v1/models \
  -H 'Authorization: Bearer <master-or-staging-key>'

curl --fail http://127.0.0.1:18790/v1/chat/completions \
  -H 'Authorization: Bearer <master-or-staging-key>' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "coding",
    "messages": [{"role": "user", "content": "Reply with exactly: staging-ok"}],
    "stream": false,
    "temperature": 0
  }'
```

A successful `/health` response alone is not sufficient. It does not prove provider credentials, model routing, fallback behavior, or client compatibility.

### Preserve existing clients during cutover

A zero-change cutover preserves:

```text
API base URL: https://api.example.com/v1
Bearer key:   existing strong client key
Model alias:  coding
```

When the previous client key is strong, at least 32 characters, and not reused as an upstream provider credential, it may temporarily become `MASTER_API_KEY`. Rotate clients later to dedicated generated keys.

When preserving the old key is unsafe or impossible, create one new key per client and update clients before switching the public origin.

### Create a dedicated agent key

The helper uses the local admin API, prompts for console credentials, and writes a mode-`600` file without printing the generated key:

```bash
PUBLIC_MODEL_API_BASE_URL=https://api.example.com/v1 \
MODEL_ALIAS=coding \
./scripts/create-agent-api-key.sh \
  hermes-production \
  "$HOME/.config/model-console/clients/hermes.env" \
  50000
```

The optional third argument is a positive monthly request limit. Create a separate file and key for every Hermes, OpenClaw, CI, cron, or application installation.

### Verify an agent key and route

```bash
set -a
source "$HOME/.config/model-console/clients/hermes.env"
set +a
./scripts/verify-agent-api.sh
```

The verifier confirms `/health`, authenticated `/v1/models`, the requested alias, and a real non-streaming completion. Run it from the actual agent host when validating DNS, TLS, Cloudflare policy, or private-network routing.

### Hermes Agent

Hermes uses `~/.hermes/config.yaml` for its main model and `~/.hermes/.env` for secrets. Back up both before merging changes.

Install when absent:

```bash
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
hermes --version
```

Merge the generated key without removing other Hermes secrets:

```bash
install -d -m 700 "$HOME/.hermes"
touch "$HOME/.hermes/.env"
chmod 600 "$HOME/.hermes/.env"

sed -i '/^OPENAI_API_KEY=/d; /^OPENAI_BASE_URL=/d' "$HOME/.hermes/.env"
grep -E '^OPENAI_(API_KEY|BASE_URL)=' \
  "$HOME/.config/model-console/clients/hermes.env" \
  >> "$HOME/.hermes/.env"
```

Merge this model block from `deploy/agents/hermes.config.example.yaml` into `~/.hermes/config.yaml`:

```yaml
model:
  default: coding
  provider: custom
  base_url: https://api.example.com/v1
```

Do not create a second top-level `model:` block. Preserve all unrelated Hermes configuration. Interactive setup is also available through `hermes model`.

Validate:

```bash
hermes doctor
hermes chat -q 'Reply with exactly: hermes-model-api-ok'
# Script-friendly final output only:
hermes -z 'Reply with exactly: hermes-model-api-ok'
```

Restart the Hermes gateway or its service manager when it does not reload environment changes automatically, then test through the real messaging channel.

### OpenClaw

OpenClaw stores its JSON5 configuration in `~/.openclaw/openclaw.json`. Back it up and merge the custom provider; do not overwrite channels, allowlists, skills, tools, MCP servers, memory, cron, hooks, sandboxing, or other agents.

Install when absent:

```bash
npm install -g openclaw@latest
openclaw onboard --install-daemon
openclaw doctor
openclaw gateway status
```

Load the dedicated key into the OpenClaw service environment or its secret-provider system:

```dotenv
MODEL_API_KEY=<dedicated OpenClaw key>
```

Merge `deploy/agents/openclaw.config.example.json5`. The core configuration is:

```json5
{
  agents: {
    defaults: {
      model: { primary: "model-console/coding" },
      models: {
        "model-console/coding": { alias: "Coding" },
      },
    },
  },
  models: {
    mode: "merge",
    providers: {
      "model-console": {
        baseUrl: "https://api.example.com/v1",
        apiKey: "${MODEL_API_KEY}",
        api: "openai-completions",
        timeoutSeconds: 300,
        models: [
          {
            id: "coding",
            name: "Coding",
            reasoning: false,
            input: ["text"],
            contextWindow: 131072,
            maxTokens: 16384,
          },
        ],
      },
    },
  },
}
```

Use `models.mode: "merge"` on an existing installation. A model allowlist entry does not register a runtime model by itself; the matching `models.providers.*.models[]` entry is also required.

Validate:

```bash
openclaw config validate
openclaw doctor
openclaw models list
openclaw models set model-console/coding
openclaw gateway status
openclaw agent --message 'Reply with exactly: openclaw-model-api-ok' --thinking high
```

Restart the actual OpenClaw service when its environment changed and was not hot-reloaded.

### Generic OpenAI-compatible agents

Most other agents use:

```dotenv
OPENAI_API_KEY=<dedicated key>
OPENAI_BASE_URL=https://api.example.com/v1
MODEL_API_MODEL=coding
```

Some clients append `/v1` automatically. Configure those with `https://api.example.com` instead. A request path containing `/v1/v1/` indicates an incorrect double suffix.

Clients that require native Anthropic Messages transport are not directly compatible; choose their custom OpenAI-compatible provider mode.

### Public route cutover and rollback

For Cloudflare Tunnel, Caddy, or Nginx, preserve the public hostname and switch only the origin after staging succeeds. Test through the public URL:

```bash
curl --fail https://api.example.com/health
curl --fail https://api.example.com/.well-known/openapi.json >/dev/null
```

Then run `scripts/verify-agent-api.sh` with the public base URL from the real agent host.

Rollback sequence:

1. stop the new API process;
2. restore the reverse-proxy or tunnel origin to the previous listener;
3. start the previous gateway;
4. verify its health, models, and one authenticated inference;
5. keep failed-state logs and the new installation for diagnosis.

Do not delete the old service, container, units, database copy, or routing config immediately after cutover.

### Acceptance criteria for an autonomous deployment

```text
[ ] Repository is on main and clean.
[ ] Runtime secrets and data remain untracked.
[ ] API and console are healthy.
[ ] Origin listeners are loopback-bound.
[ ] Public DNS and TLS work from the agent host.
[ ] Intended model alias appears in GET /v1/models.
[ ] Dedicated agent key authenticates.
[ ] A real completion succeeds.
[ ] Hermes/OpenClaw/generic client completes a real turn.
[ ] Existing client config was merged rather than overwritten.
[ ] Previous gateway remains recoverable.
[ ] Rollback was documented before cutover.
```

### Agent API discovery sequence

A client integrating this service should follow this request sequence:

1. Fetch `GET /.well-known/openapi.json` from the configured API origin.
2. Check `GET /health` without authentication.
3. Send `Authorization: Bearer <key>` for model operations.
4. Fetch `GET /v1/models` and use an advertised model alias exactly as returned.
5. Prefer `POST /v1/responses` when the client supports this service's Responses workflow; otherwise use `POST /v1/chat/completions`.
6. Set `stream: true` only when the client processes Server-Sent Events incrementally.
7. Preserve `x-request-id` in error reports.
8. Never write keys, `.env`, provider credentials, cookies, prompts, responses, or database files into Git.
9. Before deployment, run the appropriate repository checks and verify both local endpoints after restart.
10. When changing public domains, update `PUBLIC_BASE_URL`, `NEXT_PUBLIC_PUBLIC_API_URL`, `CORS_ORIGINS`, and optional `NEXT_PUBLIC_CHAT_URL`; rebuild the web application and keep `API_BACKEND_URL` private.

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

### Client-side application error after deployment

A generic browser message such as `Application error: a client-side exception has occurred` immediately after deployment usually means that an open tab still references hashed JavaScript chunks from the previous build.

The console routes are rendered dynamically and return:

```text
Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate
```

The systemd deployment script also keeps the prior build's hashed `.next/static` assets in the new build so already-open tabs can complete their requests. A small pre-hydration recovery script performs one cache-busting reload when the browser reports a chunk-loading failure.

Check the deployed headers:

```bash
curl -I https://console.example.com/dashboard | grep -i cache-control
```

When a tab was already broken before this protection was deployed, reload it once with `Ctrl+Shift+R`. Do not run two `next build` processes against the same `.next` directory, and do not run `next build` while `next start` is reading that directory.

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
