FROM node:22-alpine AS build

WORKDIR /app

ENV CI=true

RUN corepack enable && corepack prepare pnpm@11.10.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# --ignore-scripts: tsc does not need esbuild's postinstall (tsx-only).
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY tsconfig.json ./
COPY src ./src
RUN pnpm run build

FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    CI=true

RUN corepack enable && corepack prepare pnpm@11.10.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts \
    && rm -rf /root/.cache /root/.local

COPY --from=build /app/dist ./dist

USER node

EXPOSE 8787

CMD ["node", "dist/index.js"]
