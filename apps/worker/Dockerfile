FROM node:20.15.0-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN npm install -g pnpm@9.15.0
WORKDIR /workspace

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json .npmrc ./
RUN pnpm fetch

FROM deps AS build
COPY . .
RUN pnpm install --offline --frozen-lockfile
RUN pnpm --filter @openmirage/worker... build
RUN pnpm prune --prod

FROM node:20.15.0-alpine AS runtime
ENV NODE_ENV=production
RUN apk add --no-cache chromium
WORKDIR /app
COPY --from=build /workspace/package.json ./package.json
COPY --from=build /workspace/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/apps ./apps
COPY --from=build /workspace/packages ./packages
ENV WORKER_BROWSER_EXECUTABLE=/usr/bin/chromium-browser
EXPOSE 4200
CMD ["node", "apps/worker/dist/index.js"]
