# Repository instructions for automated agents

These instructions apply to the entire repository.

## Objective

Maintain a production-safe, self-hosted OpenAI-compatible model API and web console. Preserve the public API contract, configured model aliases, local secrets, persistent data, and rollback capability.

## Read first

Before changing deployment, authentication, routing, or provider code, read:

1. `README.md`
2. `docs/agent-server-deployment.md`
3. `docs/systemd.md` when native systemd is involved
4. `.env.example`
5. `config/providers.example.yml`

## Never commit runtime state

Never add, print, stage, or copy these into tracked files, patches, logs, issue text, or chat output:

- `.env`
- `config/providers.yml`
- `data/`
- SQLite databases, WAL, or SHM files
- provider credentials
- model API keys
- admin passwords, password hashes, or session secrets
- Cloudflare tunnel tokens or credential JSON
- cookies, browser profiles, backups, private keys, or certificates

Use placeholders in documentation and examples. Run `pnpm check:secrets` before every commit.

## Existing-server replacement rules

When replacing an existing gateway or installation:

1. Inventory listeners, services, containers, domains, config paths, data paths, API base URLs, client keys, and model names.
2. Back up the existing installation before stopping or editing it.
3. Stage the new service on different local ports or a different hostname.
4. Preserve the public API hostname, client key, and model alias when a zero-change client cutover is required.
5. Do not import an unrelated product's database into this service.
6. Stop the old service only after health, model discovery, authentication, and a real inference request succeed against staging.
7. Keep a tested rollback command and the old service files until post-cutover verification passes.

## Configuration rules

- Credentials belong in environment variables, never YAML.
- Provider definitions and model aliases belong in `config/providers.yml`.
- Public clients use an API origin ending in `/v1`.
- `PUBLIC_BASE_URL` and `NEXT_PUBLIC_PUBLIC_API_URL` do not include `/v1`.
- `API_BACKEND_URL` remains a private service-to-service URL.
- Bind origin ports to loopback unless a deliberate private-network design requires otherwise.
- Use dedicated generated API keys for agents instead of sharing `MASTER_API_KEY`.
- Preserve existing aliases unless the migration plan explicitly updates every client.

## Agent client rules

- Hermes main-model configuration belongs in `~/.hermes/config.yaml`; secrets belong in `~/.hermes/.env`.
- OpenClaw custom providers belong in `models.providers`; existing installations should use `models.mode: "merge"`.
- OpenClaw secrets should be environment or secret references, not literal values in `openclaw.json`.
- Generic OpenAI-compatible clients receive `OPENAI_BASE_URL`, `OPENAI_API_KEY`, and an advertised alias from `GET /v1/models`.
- Do not configure this service as a native Anthropic Messages endpoint; use the client's OpenAI-compatible mode.

## Editing discipline

- Make the smallest change that solves the requested problem.
- Do not change local `.env`, production YAML, databases, running credentials, or domains unless the user explicitly requests the runtime change.
- Do not run two `next build` processes against the same `.next` directory.
- Do not build `.next` while `next start` is reading it. Use the documented deployment flow.
- Keep source changes on `main` only when the user explicitly requests a main-branch update.

## Required validation

For documentation-only changes:

```bash
pnpm check:secrets
bash -n scripts/*.sh
git diff --check
```

For application or deployment changes:

```bash
pnpm check:secrets
pnpm typecheck
pnpm lint
pnpm build
git diff --check
```

For a live deployment, also verify:

```bash
curl --fail http://127.0.0.1:18789/health
curl --fail http://127.0.0.1:3000/login >/dev/null
```

When an agent key and model alias are available, run `scripts/verify-agent-api.sh` against the same URL the client will use.

## Definition of done

A deployment or migration is complete only when:

- the API and console services are healthy;
- `GET /v1/models` advertises the intended alias;
- an authenticated, non-streaming chat completion succeeds;
- the target agent can make a real request;
- secrets remain outside Git;
- origin listeners are not unintentionally public;
- rollback instructions remain valid;
- the repository is clean and synchronized with the requested branch.
