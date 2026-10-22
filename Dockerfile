# Verified Docker Hub multi-platform digest for the Node 22 Debian slim image.
ARG NODE_IMAGE=node:22-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d

FROM ${NODE_IMAGE} AS dependencies
WORKDIR /app
COPY mcp/package.json mcp/package-lock.json ./mcp/
RUN npm ci --prefix mcp --omit=dev --ignore-scripts

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=dependencies /app/mcp/node_modules ./mcp/node_modules
COPY mcp/package.json ./mcp/
COPY src/preflight.mjs ./src/
COPY mcp/src/server.mjs ./mcp/src/
COPY mcp/bin/server.mjs ./mcp/bin/
COPY LICENSE ./LICENSE
USER node

# Local MCP uses stdin/stdout; this image does not expose an HTTP service.
CMD ["node", "mcp/bin/server.mjs"]
