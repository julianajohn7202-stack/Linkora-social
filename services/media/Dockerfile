# Stage 1: Build stage — compile TypeScript to JavaScript
FROM node:22-alpine AS builder

WORKDIR /app

# Install all deps (including devDependencies needed for tsc)
COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Stage 2: Slim runtime stage — production-only image
FROM node:22-alpine AS runner

ENV NODE_ENV=production

RUN apk add --no-cache curl

# Create a non-root user to run the process
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

WORKDIR /app

# Install production dependencies only to keep image slim
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 3003

HEALTHCHECK --interval=10s --timeout=5s --retries=3 --start-period=30s \
  CMD curl -f http://localhost:3003/health || exit 1

CMD ["node", "dist/index.js"]
