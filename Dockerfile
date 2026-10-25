# BuildHub API for Railway (or any Docker host). See ../docs/DEPLOY_RAILWAY.md.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
# Dev tools (TypeScript, drizzle-kit) aren't needed to run; the Windows-only local Postgres is optional and skipped.
RUN npm ci --omit=dev --no-audit --no-fund
COPY src ./src
COPY scripts ./scripts
COPY sql ./sql
COPY tsconfig.json ./
# Uploaded and migrated files: mount a persistent volume here and set MEDIA_DIR=/data.
RUN mkdir -p /data
EXPOSE 8787
CMD ["npx", "tsx", "src/index.ts"]
