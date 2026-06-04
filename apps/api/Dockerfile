FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs .prettierrc ./
COPY packages/core/package.json packages/core/package.json
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --filter @ai-gateway/api... --frozen-lockfile=false

COPY packages packages
COPY apps/api apps/api
COPY config config
RUN pnpm --filter @ai-gateway/core build && pnpm --filter @ai-gateway/api build

EXPOSE 18789
CMD ["pnpm", "--filter", "@ai-gateway/api", "start"]
