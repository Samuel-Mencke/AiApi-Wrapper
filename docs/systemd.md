# Native systemd deployment

This deployment mode runs the API and web console directly with Node.js and pnpm. Both services bind to loopback and are intended to be published through Cloudflare Tunnel, Caddy, or another reverse proxy.

## 1. Choose a stable installation path

The included templates use `/home/USER/model-console`. Clone or move the repository there:

```bash
cd "$HOME"
git clone https://github.com/Samuel-Mencke/AiApi-Wrapper.git model-console
cd model-console
cp .env.example .env
cp config/providers.example.yml config/providers.yml
mkdir -p data/uploads
chmod 600 .env config/providers.yml
chmod 700 data data/uploads
```

Generate the required secrets and configure providers as described in the main README.

## 2. Install and verify dependencies

```bash
corepack enable
NODE_ENV=development pnpm install --frozen-lockfile
NODE_ENV=development pnpm check:secrets
NODE_ENV=development pnpm typecheck
NODE_ENV=development pnpm lint
```

## 3. Build the API and web console

```bash
NODE_ENV=development pnpm --filter @model-console/core build
NODE_ENV=development pnpm --filter @model-console/api build

NODE_ENV=production \
NEXT_PUBLIC_PUBLIC_API_URL="$(awk -F= '$1=="NEXT_PUBLIC_PUBLIC_API_URL" {print substr($0,index($0,"=")+1)}' .env)" \
NEXT_PUBLIC_CHAT_URL="$(awk -F= '$1=="NEXT_PUBLIC_CHAT_URL" {print substr($0,index($0,"=")+1)}' .env)" \
API_BACKEND_URL="$(awk -F= '$1=="API_BACKEND_URL" {print substr($0,index($0,"=")+1)}' .env)" \
NODE_OPTIONS= \
pnpm --filter @model-console/web build
```

## 4. Install the user services

Find the exact pnpm executable:

```bash
command -v pnpm
```

Copy the templates and replace the username. Update the pnpm path in the web unit when `command -v pnpm` returns a different path.

```bash
mkdir -p ~/.config/systemd/user
sed "s/USER/$USER/g" deploy/systemd/model-console-api.service.example \
  > ~/.config/systemd/user/model-console-api.service
sed "s/USER/$USER/g" deploy/systemd/model-console-web.service.example \
  > ~/.config/systemd/user/model-console-web.service

systemctl --user daemon-reload
systemctl --user enable --now model-console-api.service model-console-web.service
```

Keep the user manager running after logout and reboot:

```bash
sudo loginctl enable-linger "$USER"
```

Verify the services and listeners:

```bash
systemctl --user --no-pager --full status model-console-api.service model-console-web.service
ss -ltnp | grep -E ':(18789|3000)\b'
curl --fail http://127.0.0.1:18789/health
curl --fail http://127.0.0.1:3000/login >/dev/null
```

Both listeners should show `127.0.0.1`, not `0.0.0.0` or `*`.

## 5. Manual updates

Do not build into `.next` while `next start` is actively reading the same directory. Stop only the web service during its build:

```bash
git fetch origin
git checkout main
git pull --ff-only origin main

NODE_ENV=development pnpm install --frozen-lockfile
NODE_ENV=development pnpm check:secrets
NODE_ENV=development pnpm typecheck
NODE_ENV=development pnpm lint
NODE_ENV=development pnpm --filter @model-console/core build
NODE_ENV=development pnpm --filter @model-console/api build

systemctl --user stop model-console-web.service
mv apps/web/.next apps/web/.next.previous

NODE_ENV=production \
NEXT_PUBLIC_PUBLIC_API_URL="$(awk -F= '$1=="NEXT_PUBLIC_PUBLIC_API_URL" {print substr($0,index($0,"=")+1)}' .env)" \
NEXT_PUBLIC_CHAT_URL="$(awk -F= '$1=="NEXT_PUBLIC_CHAT_URL" {print substr($0,index($0,"=")+1)}' .env)" \
API_BACKEND_URL="$(awk -F= '$1=="API_BACKEND_URL" {print substr($0,index($0,"=")+1)}' .env)" \
NODE_OPTIONS= \
pnpm --filter @model-console/web build

systemctl --user restart model-console-api.service
systemctl --user start model-console-web.service
curl --fail http://127.0.0.1:18789/health
curl --fail http://127.0.0.1:3000/login >/dev/null
```

After successful verification, remove `apps/web/.next.previous`. Restore it before restarting the web service when the new build fails.

## Optional verified Git deployment timer

`scripts/auto-deploy.sh` supports `DEPLOY_MODE=systemd` and `DEPLOY_MODE=docker`. In systemd mode it:

1. Refuses to overwrite a dirty tracked working tree.
2. Fetches and fast-forwards the configured branch.
3. Installs the frozen lockfile.
4. Runs secret, type, and lint checks.
5. Builds the shared package and API.
6. Backs up the current web build.
7. Stops the web service, creates the new web build, and restores the prior build on failure.
8. Copies missing hashed assets from the previous `.next/static` directory into the new build so open browser tabs do not receive chunk 404s.
9. Restarts services and verifies both local endpoints.

Prepare the root-owned timer templates:

```bash
USER_ID="$(id -u)"
sed -e "s/USER_ID/$USER_ID/g" -e "s/USER/$USER/g" \
  deploy/systemd/model-console-autodeploy.service.example \
  | sudo tee /etc/systemd/system/model-console-autodeploy.service >/dev/null
sudo cp deploy/systemd/model-console-autodeploy.timer.example \
  /etc/systemd/system/model-console-autodeploy.timer

sudo touch /var/log/model-console-deploy.log /var/lock/model-console-deploy.lock
sudo chown "$USER:docker" /var/log/model-console-deploy.log /var/lock/model-console-deploy.lock
sudo chmod 0640 /var/log/model-console-deploy.log
sudo chmod 0660 /var/lock/model-console-deploy.lock
sudo systemctl daemon-reload
sudo systemctl enable --now model-console-autodeploy.timer
```

Inspect timer and deployment output:

```bash
systemctl list-timers model-console-autodeploy.timer
sudo journalctl -u model-console-autodeploy.service -n 200 --no-pager
sudo tail -n 200 /var/log/model-console-deploy.log
```

The repository must be able to fetch its remote non-interactively. Use an SSH deploy key, GitHub CLI credential helper, or another server-side credential mechanism that does not place a token inside the repository.
