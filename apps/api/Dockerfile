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
RUN pnpm --filter @openmirage/api... build

FROM build AS tools

FROM build AS pruned
RUN pnpm prune --prod

FROM node:20.15.0-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN npm install -g pnpm@9.15.0
COPY --from=pruned /workspace/package.json ./package.json
COPY --from=pruned /workspace/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=pruned /workspace/node_modules ./node_modules
COPY --from=pruned /workspace/apps ./apps
COPY --from=pruned /workspace/packages ./packages
EXPOSE 4000
CMD ["node", "apps/api/dist/index.js"]
