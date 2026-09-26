# Stage 1: Build stage with libvips build dependencies for sharp
FROM node:22-alpine AS builder

# Install build tools and libvips development headers for native sharp compilation
RUN apk add --no-cache make gcc g++ python3 vips-dev build-base

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Stage 2: Slim runtime stage with libvips runtime libraries only
FROM node:22-alpine AS runner

ENV NODE_ENV=production

# Install only the runtime libraries for libvips and curl for healthcheck
RUN apk add --no-cache vips curl

RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist

RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 3003

HEALTHCHECK --interval=10s --timeout=5s --retries=3 --start-period=30s \
  CMD curl -f http://localhost:3003/health || exit 1

CMD ["node", "dist/index.js"]
