FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:18789

COPY package.json pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs .prettierrc ./
COPY packages/core/package.json packages/core/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --filter @ai-gateway/web... --frozen-lockfile=false

COPY packages packages
COPY apps/web apps/web
RUN pnpm --filter @ai-gateway/core build && \
    NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL pnpm --filter @ai-gateway/web build

EXPOSE 3000
CMD ["pnpm", "--filter", "@ai-gateway/web", "start"]
