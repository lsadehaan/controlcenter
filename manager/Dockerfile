# Control Center Manager
# Multi-stage build for production deployment

FROM node:24-alpine AS base

# Metadata labels for proper package linking
LABEL org.opencontainers.image.source="https://github.com/lsadehaan/controlcenter"
LABEL org.opencontainers.image.description="Control Center Manager - Web UI and API"
LABEL org.opencontainers.image.licenses="AGPL-3.0"
LABEL org.opencontainers.image.vendor="lsadehaan"
LABEL org.opencontainers.image.title="Control Center Manager"

# Install dependencies for git operations
RUN apk add --no-cache git openssh-client

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Create required directories
RUN mkdir -p data/config-repo data/logs && \
    chmod -R 755 data

# Expose ports
EXPOSE 3000 2223

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})" || exit 1

# Run as non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

# Start the application
CMD ["node", "src/server.js"]