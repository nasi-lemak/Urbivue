# Urbivue API — multi-stage build via pnpm workspace deploy.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @urbivue/shared... --filter @urbivue/api...
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @urbivue/shared build && pnpm --filter @urbivue/api build
RUN pnpm --filter @urbivue/api deploy --prod --legacy /out

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
EXPOSE 3000
# Migrations are compiled alongside the app:
#   node dist/platform/db/migrate.js
CMD ["node", "dist/main.js"]
