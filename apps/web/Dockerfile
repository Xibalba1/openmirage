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
RUN pnpm --filter @openmirage/web... build

FROM nginx:1.27-alpine AS runtime
COPY docker/nginx-web.conf /etc/nginx/conf.d/default.conf
COPY docker/runtime-config.template.js /opt/openmirage/runtime-config.template.js
COPY docker/web-entrypoint.sh /docker-entrypoint.d/40-openmirage-runtime-config.sh
COPY --from=build /workspace/apps/web/dist /usr/share/nginx/html
COPY --from=build /workspace/apps/web/public/runtime-config.js /usr/share/nginx/html/runtime-config.js
EXPOSE 80
