# Agent server deployment, migration, and client setup

This runbook is written for both human operators and autonomous coding or operations agents. It covers a fresh installation, replacement of an existing model gateway, preservation of client compatibility, dedicated API-key creation, Hermes Agent configuration, OpenClaw configuration, verification, cutover, and rollback.

The examples use these placeholders:

- repository path: `$HOME/model-console`
- public API origin: `https://api.example.com`
- OpenAI-compatible base URL: `https://api.example.com/v1`
- public console origin: `https://console.example.com`
- model alias: `coding`
- local API listener: `127.0.0.1:18789`
- local console listener: `127.0.0.1:3000`

Replace placeholders deliberately. Do not replace local private URLs with public URLs inside `API_BACKEND_URL`.

## 1. Supported client contract

The service is intended for agents that support an OpenAI-compatible API. The normal client contract is:

```text
Base URL: https://api.example.com/v1
Authentication: Authorization: Bearer <dedicated client key>
Model: an enabled alias returned by GET /v1/models
Primary route: POST /v1/chat/completions
Optional route: POST /v1/responses
Streaming: Server-Sent Events when stream=true
```

The service does not expose a native Anthropic `/v1/messages` endpoint. An agent that supports only Anthropic-native transport must be switched to its OpenAI-compatible provider mode.

Use the base model alias such as `coding`. The API also advertises generated `-u` variants; use one only when the client configuration intentionally requires that variant.

## 2. Choose the deployment path

Use one of these paths:

| Situation                           | Recommended path                                                          |
| ----------------------------------- | ------------------------------------------------------------------------- |
| New Linux server                    | Fresh install with Docker Compose or native systemd                       |
| Existing Model Console installation | In-place upgrade after backup, preserving `.env`, YAML, and SQLite        |
| Existing unrelated gateway          | Side-by-side replacement; recreate providers, aliases, and keys           |
| Existing Hermes or OpenClaw client  | Merge model-provider settings; do not overwrite the entire client config  |
| Zero client downtime                | Preserve API hostname, key, and model alias, then switch the origin route |

For an unrelated gateway, never copy its database into `data/gateway.db`. Database schemas are product-specific. Preserve compatibility at the HTTP layer instead.

## 3. Inventory an existing server

Run this before changing anything:

```bash
set -euo pipefail

uname -a
id
pwd

git --version || true
node --version || true
pnpm --version || true
docker --version || true
docker compose version || true
cloudflared --version || true

ss -ltnp
systemctl --user list-units --type=service --all
systemctl list-units --type=service --all | grep -Ei 'gateway|model|openclaw|hermes|cloudflared|caddy' || true
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}'

find "$HOME" -maxdepth 4 -type f \
  \( -name '.env' -o -name 'openclaw.json' -o -name 'config.yaml' -o -name 'providers.yml' -o -name '*.service' \) \
  -print 2>/dev/null
```

Record, without printing secret values:

- current service names and service manager;
- current repository or installation path;
- local API and dashboard ports;
- public API and console hostnames;
- Cloudflare Tunnel, Caddy, Nginx, or other reverse-proxy routes;
- current client base URL;
- current model names used by Hermes, OpenClaw, cron jobs, and other agents;
- whether clients use one shared key or separate keys;
- database and upload paths;
- provider names and credential variable names;
- required downtime window and rollback owner.

Do not run `cat .env` in an agent transcript. Inspect only key names when needed:

```bash
awk -F= '/^[A-Z][A-Z0-9_]*=/ { print $1"=<set>" }' /path/to/.env
```

## 4. Back up the old installation

Create a protected backup outside the repository:

```bash
set -euo pipefail

backup_root="$HOME/backups/model-console/$(date +%Y%m%d-%H%M%S)"
install -d -m 700 "$backup_root"

# Replace paths after inventory.
cp -a /path/to/old/.env "$backup_root/old.env"
cp -a /path/to/old/providers.yml "$backup_root/old-providers.yml" 2>/dev/null || true
cp -a /path/to/old/openclaw.json "$backup_root/openclaw.json" 2>/dev/null || true
cp -a /path/to/old/hermes-config.yaml "$backup_root/hermes-config.yaml" 2>/dev/null || true

systemctl --user cat old-service.service >"$backup_root/old-service.unit" 2>/dev/null || true
docker inspect old-container >"$backup_root/old-container.inspect.json" 2>/dev/null || true

chmod -R go-rwx "$backup_root"
find "$backup_root" -type f -exec sha256sum {} + >"$backup_root/SHA256SUMS"
```

If the old application uses SQLite, stop only the database-writing process before copying the database, or use that application's documented online backup method:

```bash
systemctl --user stop old-api.service
cp -a /path/to/old/database.db "$backup_root/database.db"
systemctl --user start old-api.service
```

Also export or record reverse-proxy and tunnel configuration. A complete application backup without the routing configuration is not a complete rollback.

## 5. Fresh server installation

### 5.1 Clone and create local runtime files

```bash
cd "$HOME"
git clone https://github.com/Samuel-Mencke/AiApi-Wrapper.git model-console
cd model-console
git switch main

cp .env.example .env
cp config/providers.example.yml config/providers.yml
install -d -m 700 data data/uploads
chmod 600 .env config/providers.yml
```

### 5.2 Generate service secrets

Install dependencies first because password hashing is provided by the repository:

```bash
corepack enable
pnpm install --frozen-lockfile
```

Generate the master key and admin session secret:

```bash
openssl rand -hex 32
openssl rand -hex 32
```

Generate the password hash:

```bash
read -rsp "Admin password: " ADMIN_PASSWORD
echo
printf '%s' "$ADMIN_PASSWORD" | pnpm admin:hash-password
unset ADMIN_PASSWORD
```

Write the results into `.env`:

```dotenv
MASTER_API_KEY=<random value of at least 32 characters>
ADMIN_USERNAME=<console username>
ADMIN_PASSWORD_HASH=<pbkdf2_sha256 output>
ADMIN_SESSION_SECRET=<different random value of at least 32 characters>
```

Never reuse a provider credential as `MASTER_API_KEY`.

### 5.3 Configure URLs

For a public two-host deployment:

```dotenv
HOST=0.0.0.0
PORT=18789
DASHBOARD_PORT=3000
PUBLIC_BASE_URL=https://api.example.com
NEXT_PUBLIC_PUBLIC_API_URL=https://api.example.com
API_BACKEND_URL=http://127.0.0.1:18789
NEXT_PUBLIC_CHAT_URL=
CORS_ORIGINS=https://console.example.com
ADMIN_COOKIE_DOMAIN=
ENABLE_PROMPT_LOGGING=false
```

Rules:

- `PUBLIC_BASE_URL` has no `/v1` suffix.
- `NEXT_PUBLIC_PUBLIC_API_URL` has no `/v1` suffix.
- client base URLs normally end in `/v1`.
- `API_BACKEND_URL` is private and usually loopback or a Docker service name.
- keep `ADMIN_COOKIE_DOMAIN` empty when the console uses the built-in same-origin `/api` proxy.
- rebuild the web application after changing `NEXT_PUBLIC_*` values.

### 5.4 Configure providers and aliases

Put provider credentials in `.env` only:

```dotenv
OPENAI_API_KEY=<provider key>
OPENROUTER_API_KEY=<provider key>
ZAI_API_KEY=<provider key>
CUSTOM_PROVIDER_API_KEY=<provider key>
```

Put routing in `config/providers.yml`:

```yaml
providers:
  primary:
    type: custom
    baseUrl: https://provider.example.com/v1
    apiKeyEnv: CUSTOM_PROVIDER_API_KEY
    enabled: true

  fallback-provider:
    type: openrouter
    enabled: true

models:
  coding:
    provider: primary
    model: upstream-coding-model
    context_length: 131072
    max_output_tokens: 16384
    enabled: true
    fallback:
      - provider: fallback-provider
        model: fallback/coding-model
```

Clients use `coding`; upstream providers receive their configured upstream model IDs.

When replacing an existing gateway, use the old public model name as the alias when possible. Preserving an alias avoids changes across every agent, cron job, and service unit.

### 5.5 Deploy

Docker Compose:

```bash
pnpm check:secrets
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

Native systemd:

```bash
cat docs/systemd.md
```

Follow that guide exactly. Do not run `next build` while `next start` reads the same `.next` directory.

### 5.6 Verify local origin health

```bash
curl --fail http://127.0.0.1:18789/health
curl --fail http://127.0.0.1:3000/login >/dev/null
ss -ltnp | grep -E ':(18789|3000)\b'
```

The public host should normally see only the reverse proxy or tunnel. The application listeners should remain on loopback through Docker port publishing or systemd service configuration.

## 6. Replacing an existing gateway without breaking agents

### 6.1 Compatibility-first strategy

The least disruptive cutover preserves all three client-facing identifiers:

1. the public API hostname;
2. the Bearer key;
3. the model alias.

Example:

```text
Before: https://api.example.com/v1 + old-client-key + coding
After:  https://api.example.com/v1 + same-client-key + coding
```

To preserve the old key temporarily, set it as `MASTER_API_KEY` only when it is a strong value of at least 32 characters and is not also a provider credential. After cutover, create separate client keys and rotate agents gradually.

A safer long-term design is one generated key per agent installation.

### 6.2 Stage on alternate local ports

For Docker, use temporary host ports while the old gateway remains active:

```bash
PORT=18790 DASHBOARD_PORT=3001 docker compose -p model-console-staging up -d --build

curl --fail http://127.0.0.1:18790/health
curl --fail http://127.0.0.1:3001/login >/dev/null
```

The container still listens on its internal standard ports. Only host publishing changes.

For native systemd, use a separate checkout and temporary service units with alternate `PORT`, `DASHBOARD_PORT`, database path, and service names. Do not point staging at the production SQLite file while production writes to it.

### 6.3 Test the staged API directly

Use the master key only for initial administrative testing:

```bash
curl --fail http://127.0.0.1:18790/v1/models \
  -H 'Authorization: Bearer <master key>'
```

Run a real request:

```bash
curl --fail http://127.0.0.1:18790/v1/chat/completions \
  -H 'Authorization: Bearer <master key>' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "coding",
    "messages": [{"role": "user", "content": "Reply with exactly: staging-ok"}],
    "stream": false,
    "temperature": 0
  }'
```

Do not cut over based only on `/health`. Health proves process readiness, not provider authentication or inference success.

### 6.4 Same-product database migration

When upgrading an older installation of this repository, preserve:

- `.env` after reconciling renamed variables with `.env.example`;
- `config/providers.yml`;
- `data/gateway.db`;
- `data/uploads/` when needed.

Stop the old API before copying SQLite:

```bash
systemctl --user stop old-model-api.service
cp -a /old/path/data/gateway.db /new/path/data/gateway.db
cp -a /old/path/data/uploads/. /new/path/data/uploads/
systemctl --user start old-model-api.service
```

Use `docker compose stop api` and volume-copy commands for Docker-managed data.

Do not copy a database from LiteLLM, Open WebUI, OpenClaw, Hermes, or another unrelated gateway into this service.

### 6.5 Cut over the public route

Cloudflare Tunnel:

1. keep the existing public hostname;
2. change its origin service from the old port to the new port;
3. verify the route configuration;
4. restart or reload the connector when locally managed;
5. test public health, models, and inference;
6. leave the old process stopped but available until acceptance tests pass.

Caddy or Nginx:

1. change only the upstream origin;
2. validate configuration before reload;
3. reload rather than fully stop the reverse proxy;
4. test through the public hostname.

When the new service will occupy the old local port, use this sequence:

```bash
# Stop old writer/service.
systemctl --user stop old-gateway.service

# Stop staging and start production binding.
PORT=18790 DASHBOARD_PORT=3001 docker compose -p model-console-staging down
PORT=18789 DASHBOARD_PORT=3000 docker compose up -d

curl --fail http://127.0.0.1:18789/health
```

Adapt commands to the actual service manager. Do not blindly execute example service names.

### 6.6 Rollback

Define rollback before cutover:

```text
1. Stop the new API process.
2. Restore the reverse-proxy or tunnel origin to the old listener.
3. Start the old service.
4. Verify old /health and one authenticated inference.
5. Preserve new logs and failed state for diagnosis.
```

Do not delete old units, containers, database copies, or routing configuration immediately after cutover. Retain them until the agreed observation period passes.

## 7. Create a dedicated API key for each agent

Start with a healthy local API and valid console credentials. The helper prompts for the admin credentials and does not print the generated plaintext key:

```bash
cd "$HOME/model-console"

PUBLIC_MODEL_API_BASE_URL=https://api.example.com/v1 \
MODEL_ALIAS=coding \
./scripts/create-agent-api-key.sh \
  hermes-production \
  "$HOME/.config/model-console/clients/hermes.env" \
  50000
```

The third argument is an optional positive monthly request limit. The output file is mode `600` and contains both common OpenAI variables and neutral `MODEL_API_*` variables.

Create a separate file for OpenClaw:

```bash
PUBLIC_MODEL_API_BASE_URL=https://api.example.com/v1 \
MODEL_ALIAS=coding \
./scripts/create-agent-api-key.sh \
  openclaw-production \
  "$HOME/.config/model-console/clients/openclaw.env"
```

Do not commit these output files. Do not paste generated keys into README, `openclaw.json`, `config/providers.yml`, service units, or shell history.

The console can also create keys manually under **API Keys**. Copy a generated key immediately; only its hash is stored.

## 8. Verify a client key before configuring an agent

Load the generated environment file into the current shell and run the end-to-end verifier:

```bash
set -a
source "$HOME/.config/model-console/clients/hermes.env"
set +a

cd "$HOME/model-console"
./scripts/verify-agent-api.sh
```

The verifier checks:

1. unauthenticated `/health`;
2. authenticated `/v1/models`;
3. presence of `MODEL_API_MODEL`;
4. a real non-streaming chat completion.

Run it from the same host and network path that the agent uses. A local-loopback test does not prove that DNS, TLS, Cloudflare policy, or remote firewall rules are correct.

## 9. Hermes Agent setup

Current Hermes Agent supports custom OpenAI-compatible endpoints. Its main model configuration belongs in `~/.hermes/config.yaml`, while secrets belong in `~/.hermes/.env`.

### 9.1 Back up an existing Hermes installation

```bash
install -d -m 700 "$HOME/backups/hermes"
cp -a "$HOME/.hermes/config.yaml" "$HOME/backups/hermes/config.yaml.$(date +%Y%m%d-%H%M%S)" 2>/dev/null || true
cp -a "$HOME/.hermes/.env" "$HOME/backups/hermes/env.$(date +%Y%m%d-%H%M%S)" 2>/dev/null || true
```

Do not replace the entire file when Hermes already contains messaging, tools, MCP, memory, terminal, or gateway settings.

### 9.2 Install Hermes when absent

Use the current official installation method:

```bash
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
source "$HOME/.bashrc" 2>/dev/null || true
hermes --version
```

Review installation scripts before executing them in restricted environments.

### 9.3 Merge the dedicated key into Hermes secrets

Assuming the generated client file is `~/.config/model-console/clients/hermes.env`:

```bash
install -d -m 700 "$HOME/.hermes"
touch "$HOME/.hermes/.env"
chmod 600 "$HOME/.hermes/.env"

sed -i '/^OPENAI_API_KEY=/d; /^OPENAI_BASE_URL=/d' "$HOME/.hermes/.env"
grep -E '^OPENAI_(API_KEY|BASE_URL)=' \
  "$HOME/.config/model-console/clients/hermes.env" \
  >> "$HOME/.hermes/.env"
```

This preserves unrelated Hermes credentials.

### 9.4 Merge the model block

Use `deploy/agents/hermes.config.example.yaml` as the source. The essential block is:

```yaml
model:
  default: coding
  provider: custom
  base_url: https://api.example.com/v1
```

If a `model:` block already exists, update only its `default`, `provider`, and `base_url` fields. Do not duplicate the top-level key.

For interactive configuration, run:

```bash
hermes model
```

Choose the custom/self-hosted endpoint, then enter:

```text
Base URL: https://api.example.com/v1
API key: the dedicated Hermes key
Model: coding
```

### 9.5 Validate Hermes

```bash
hermes doctor
hermes chat -q 'Reply with exactly: hermes-model-api-ok'
```

For script-only output:

```bash
hermes -z 'Reply with exactly: hermes-model-api-ok'
```

If Hermes runs as a messaging gateway or service, restart it through its configured service manager after changing environment values. Then send a test message through the actual Telegram, Discord, Slack, or other production channel.

### 9.6 Existing Hermes notes

- Preserve `~/.hermes/config.yaml` sections unrelated to `model`.
- Preserve existing tool credentials in `~/.hermes/.env`.
- Use `provider: custom` for the main model.
- Keep the explicit `base_url` in `config.yaml`; do not rely only on legacy environment routing.
- `OPENAI_API_KEY` remains the secret used for the custom endpoint.
- Verify auxiliary tasks separately when they use another provider or model.

## 10. OpenClaw setup

Current OpenClaw stores its main JSON5 configuration in `~/.openclaw/openclaw.json`. Custom OpenAI-compatible providers are defined under `models.providers`.

### 10.1 Back up and inspect existing configuration

```bash
install -d -m 700 "$HOME/backups/openclaw"
cp -a "$HOME/.openclaw/openclaw.json" \
  "$HOME/backups/openclaw/openclaw.json.$(date +%Y%m%d-%H%M%S)" 2>/dev/null || true

openclaw config get agents.defaults.model.primary || true
openclaw models list || true
openclaw gateway status || true
```

Do not overwrite an existing config containing channels, allowlists, skills, tools, sandboxing, cron, hooks, memory, MCP servers, or multiple agents.

### 10.2 Install OpenClaw when absent

Use the current official package installation and onboarding commands:

```bash
npm install -g openclaw@latest
openclaw onboard --install-daemon
openclaw --version
openclaw doctor
openclaw gateway status
```

### 10.3 Load the dedicated key securely

The template `deploy/agents/openclaw.env.example` uses:

```dotenv
MODEL_API_KEY=<dedicated OpenClaw key>
```

Load that variable into the OpenClaw service environment or configure an OpenClaw secret provider. Do not put the literal key inside `openclaw.json`.

For a temporary shell validation:

```bash
set -a
source "$HOME/.config/model-console/clients/openclaw.env"
set +a
```

For a persistent systemd service, use a protected environment file in a drop-in and restart the service. Use the actual unit name discovered with `systemctl --user list-units`; do not assume one.

### 10.4 Merge the custom provider

Use `deploy/agents/openclaw.config.example.json5`. The important properties are:

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

Migration rules:

- keep `models.mode: "merge"` to retain existing providers;
- add the provider definition under `models.providers`;
- add `model-console/coding` to `agents.defaults.models` when that object already acts as an allowlist;
- change `agents.defaults.model.primary` only when the new route should become default;
- set `contextWindow` and `maxTokens` to the actual limits of the configured alias;
- set `input: ["text", "image"]` only when the entire route supports image input;
- use `api: "openai-completions"` for this gateway;
- keep `apiKey` as an environment reference.

### 10.5 Validate OpenClaw

```bash
openclaw config validate
openclaw doctor
openclaw models list
openclaw models set model-console/coding
openclaw gateway status
```

Run a real agent turn:

```bash
openclaw agent --message 'Reply with exactly: openclaw-model-api-ok' --thinking high
```

If the gateway service does not hot-reload the environment, restart it through OpenClaw or its service manager, then repeat `openclaw gateway status` and the real agent request.

### 10.6 Existing OpenClaw notes

- OpenClaw model references use `provider/model`, so the configured reference is `model-console/coding`.
- A model entry under `agents.defaults.models` does not register a custom runtime model by itself; the matching `models.providers.model-console.models[]` entry is also required.
- Preserve channel allowlists and DM policies.
- Run `openclaw doctor --fix` only after reviewing the proposed repair and keeping a backup.
- Use OpenClaw's secret-provider system when available for long-running production deployments.

## 11. Generic OpenAI-compatible agent setup

Copy `deploy/agents/generic-openai.env.example` into a protected client-specific path and replace the key and URL:

```dotenv
OPENAI_API_KEY=<dedicated key>
OPENAI_BASE_URL=https://api.example.com/v1
MODEL_API_KEY=<same dedicated key>
MODEL_API_BASE_URL=https://api.example.com/v1
MODEL_API_MODEL=coding
```

Common client differences:

| Client setting                        | Correct value                               |
| ------------------------------------- | ------------------------------------------- |
| Client expects a full OpenAI base URL | `https://api.example.com/v1`                |
| Client appends `/v1` itself           | `https://api.example.com`                   |
| Client asks for API host              | Usually `https://api.example.com`           |
| Client asks for model                 | `coding` or another alias from `/v1/models` |
| Client asks for provider type         | OpenAI-compatible / custom OpenAI           |
| Client asks for organization/project  | Leave empty unless required by that client  |

Verify the exact URL behavior. A duplicated path such as `/v1/v1/chat/completions` indicates that both the client and configuration appended `/v1`.

## 12. Supplying keys to long-running agent services

### systemd user service

Create a protected file:

```bash
install -d -m 700 "$HOME/.config/model-console/clients"
chmod 600 "$HOME/.config/model-console/clients/agent.env"
```

Add an `EnvironmentFile` drop-in to the actual agent unit:

```bash
systemctl --user edit actual-agent.service
```

Example drop-in:

```ini
[Service]
EnvironmentFile=/home/USER/.config/model-console/clients/agent.env
```

Then:

```bash
systemctl --user daemon-reload
systemctl --user restart actual-agent.service
systemctl --user status actual-agent.service --no-pager
```

Replace `USER` and the service name. Do not place the key directly in the unit because unit contents are commonly collected in diagnostics.

### Docker Compose agent

Reference an external protected file:

```yaml
services:
  agent:
    env_file:
      - /home/USER/.config/model-console/clients/agent.env
```

Do not copy the file into an image or repository build context.

### Same-host agent

A same-host agent can use:

```text
http://127.0.0.1:18789/v1
```

This avoids public DNS and tunnel dependency. A containerized agent on a different Docker network cannot use host loopback directly; use a shared network, a stable internal DNS name, or `host.docker.internal` with explicit host-gateway mapping.

### Remote agent

A remote server should use the HTTPS public URL or a private tailnet/LAN URL with valid routing and authentication. Do not expose the raw origin port to the internet merely to simplify client configuration.

## 13. Public-domain and Cloudflare cutover checks

Before configuring remote agents:

```bash
curl --fail https://api.example.com/health
curl --fail https://api.example.com/.well-known/openapi.json >/dev/null
curl -I https://console.example.com/login
```

Then test authenticated model discovery and inference with a dedicated key.

Cloudflare rules:

- publish API and console as separate hostnames;
- do not cache `/v1/*`, `/admin/*`, `/health`, or discovery JSON;
- protect the console with Access when appropriate;
- do not put an interactive browser-only Access login in front of API clients;
- use service tokens or mTLS when extra machine authentication is needed;
- keep tunnel credentials outside Git;
- keep origin listeners on loopback.

## 14. Acceptance checklist

An agent or operator should not declare completion until every applicable check passes:

```text
[ ] Repository is on main and clean.
[ ] .env and config/providers.yml are present locally and ignored by Git.
[ ] Secret scan passes.
[ ] API and console origin health checks pass.
[ ] Origin listeners are loopback-bound.
[ ] Public DNS and TLS resolve correctly.
[ ] GET /v1/models advertises the intended alias.
[ ] Dedicated agent key authenticates successfully.
[ ] Real chat completion succeeds.
[ ] Hermes/OpenClaw/generic agent completes a real turn.
[ ] Existing agent config sections were merged, not overwritten.
[ ] Old gateway remains recoverable until observation completes.
[ ] Rollback command and routing restoration are documented.
[ ] No secret appears in Git status, staged files, logs, or shell transcript.
```

Repository validation:

```bash
pnpm check:secrets
bash -n scripts/create-agent-api-key.sh scripts/verify-agent-api.sh
git diff --check
```

Application changes additionally require:

```bash
pnpm typecheck
pnpm lint
pnpm build
```

## 15. Failure matrix

| Symptom                              | Likely cause                                   | Check                                                                 |
| ------------------------------------ | ---------------------------------------------- | --------------------------------------------------------------------- |
| `401 API key required`               | Missing or wrong service Bearer key            | Header, generated key status, correct API hostname                    |
| Provider returns `401`               | Wrong upstream provider credential             | `.env`, `apiKeyEnv`, provider enabled state                           |
| `model_not_found`                    | Client model differs from alias                | `GET /v1/models`, YAML alias, OpenClaw model ID                       |
| `/v1/v1/...` request path            | Both client and config append `/v1`            | Client base-URL semantics                                             |
| Hermes ignores endpoint              | Main model still points to another provider    | `~/.hermes/config.yaml`, `hermes model`, `hermes doctor`              |
| OpenClaw cannot find model           | Provider model not registered                  | `models.providers.*.models[]`, allowlist, `models.mode`               |
| OpenClaw config refuses startup      | Invalid JSON5 or unknown schema field          | `openclaw config validate`, `openclaw doctor`                         |
| Agent works locally but not remotely | DNS, TLS, tunnel, Access, firewall, or routing | Test from agent host using public URL                                 |
| Docker agent cannot reach host API   | Container loopback points to itself            | Shared network or `host.docker.internal` mapping                      |
| Console works but API client fails   | API hostname policy differs from console       | Cloudflare Access, CORS is irrelevant to server clients, route origin |
| Streaming hangs                      | Proxy buffering or client SSE handling         | Test non-streaming, then `curl --no-buffer`                           |
| Cutover works but old tab crashes    | Stale Next.js chunks                           | Hard reload once; preserve prior hashed assets during deployment      |

## 16. Upstream client references

Hermes Agent:

- https://github.com/NousResearch/hermes-agent
- https://hermes-agent.nousresearch.com/docs/integrations/providers
- https://hermes-agent.nousresearch.com/docs/reference/environment-variables
- https://hermes-agent.nousresearch.com/docs/reference/cli-commands

OpenClaw:

- https://github.com/openclaw/openclaw
- https://github.com/openclaw/openclaw/blob/main/docs/gateway/configuration.md
- https://github.com/openclaw/openclaw/blob/main/docs/concepts/model-providers.md
- https://github.com/openclaw/openclaw/blob/main/docs/gateway/secrets.md

These projects evolve independently. Before changing a production client, compare its installed version with current upstream documentation and validate the configuration with that client's own diagnostic commands.
