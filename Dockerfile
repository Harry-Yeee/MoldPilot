# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"
WORKDIR /app
RUN apt-get update \
    && apt-get install --yes --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && corepack prepare pnpm@11.5.3 --activate

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=moldpilot-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM base AS builder
ARG DATABASE_URL="postgresql://moldpilot_build:moldpilot_build@127.0.0.1:5432/moldpilot_build?schema=public"
ENV DATABASE_URL="${DATABASE_URL}"
ENV NODE_ENV="production"
ENV NEXT_TELEMETRY_DISABLED="1"
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN pnpm exec prisma generate
RUN pnpm build

# Disposable smoke tests use this target for `prisma migrate deploy`. It is not
# copied into the production runtime image and is never the default target.
FROM builder AS migrator
ENTRYPOINT ["pnpm", "exec", "prisma"]
CMD ["migrate", "deploy"]

FROM ${NODE_IMAGE} AS runner
ENV NODE_ENV="production"
ENV NEXT_TELEMETRY_DISABLED="1"
ENV HOSTNAME="0.0.0.0"
ENV PORT="3000"
WORKDIR /app

RUN apt-get update \
    && apt-get install --yes --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 moldpilot \
    && useradd --uid 10001 --gid moldpilot --no-create-home --home-dir /app \
      --shell /usr/sbin/nologin moldpilot \
    && mkdir -p /data/uploads /data/quarantine \
    && chown -R 10001:10001 /data

COPY --from=builder --chown=10001:10001 /app/.next/standalone ./
COPY --from=builder --chown=10001:10001 /app/.next/static ./.next/static
COPY --from=builder --chown=10001:10001 /app/public ./public
COPY --from=builder --chown=10001:10001 /app/scripts/container-entrypoint.sh ./scripts/container-entrypoint.sh
COPY --from=builder --chown=10001:10001 /app/scripts/check-container-runtime.mjs ./scripts/check-container-runtime.mjs
COPY --from=builder --chown=10001:10001 /app/src/domain/security/session-cookie.ts ./src/domain/security/session-cookie.ts
COPY --from=builder --chown=10001:10001 /app/src/domain/security/runtime-directory.ts ./src/domain/security/runtime-directory.ts

RUN chmod 0555 /app/scripts/container-entrypoint.sh \
    /app/scripts/check-container-runtime.mjs

USER 10001:10001
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health/live',{cache:'no-store'}).then((response)=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"]
ENTRYPOINT ["/app/scripts/container-entrypoint.sh"]
CMD ["node", "server.js"]
