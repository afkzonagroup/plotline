# Copyright 2026 MB AFKzona Group
# SPDX-License-Identifier: AGPL-3.0-only
#
# Plotline CLI image. No runtime dependencies besides Node.js; runs as an
# unprivileged user and needs no network. Usage:
#   docker build -t plotline .
#   docker run --rm --cap-drop=ALL --security-opt no-new-privileges --network none -v "$PWD:/work" plotline validate plots.geojson

FROM node:22-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npx tsc -p tsconfig.build.json

FROM node:22-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY package.json LICENSE LICENSE-ADDITIONAL-TERMS.md ./
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /usr/local/lib/node_modules/corepack /usr/local/bin/corepack /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg \
    && groupadd --system plotline \
    && useradd --system --gid plotline --home-dir /home/plotline --create-home --shell /usr/sbin/nologin plotline \
    && mkdir -p /work && chown plotline:plotline /work
USER plotline
WORKDIR /work
ENTRYPOINT ["node", "/app/dist/cli/main.js"]
CMD ["--help"]
