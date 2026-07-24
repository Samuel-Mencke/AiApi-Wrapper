FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

ARG NEXT_PUBLIC_PUBLIC_API_URL=http://localhost:18789
ARG NEXT_PUBLIC_CHAT_URL=

COPY package.json pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs .prettierrc ./
COPY packages/core/package.json packages/core/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --filter @model-console/web... --frozen-lockfile=false

COPY packages packages
COPY apps/web apps/web
RUN pnpm --filter @model-console/core build && \
    NEXT_PUBLIC_PUBLIC_API_URL=$NEXT_PUBLIC_PUBLIC_API_URL NEXT_PUBLIC_CHAT_URL=$NEXT_PUBLIC_CHAT_URL pnpm --filter @model-console/web build

EXPOSE 3000
CMD ["pnpm", "--filter", "@model-console/web", "start"]
