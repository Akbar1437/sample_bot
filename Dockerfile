# Build stage
FROM node:18-alpine AS builder

# Create app directory
WORKDIR /app

# Install python/build dependencies for node-gyp
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies)
RUN npm ci

# Copy source
COPY . .

# Build TypeScript
RUN npm run build

# Production stage
FROM node:18-alpine

# Set NODE_ENV
ENV NODE_ENV=production

WORKDIR /app

# Install python/build dependencies (some npm packages need them)
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production

# Copy built JavaScript from builder stage
COPY --from=builder /app/dist ./dist

# Copy other necessary files
COPY .env* ./
COPY scripts ./scripts

# Create volume mount point for QR codes
VOLUME ["/app/qr_codes"]

# Non-root user for security
RUN addgroup -S appuser && adduser -S appuser -G appuser
RUN chown -R appuser:appuser /app
USER appuser

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget -q --spider http://localhost:${PORT:-3000}/health || exit 1

# Start the bot
CMD ["node", "dist/index.js"]