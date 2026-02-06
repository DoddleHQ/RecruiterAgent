# Production Dockerfile with non-root user (Debian-based for ONNX Runtime compatibility)
FROM node:20-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user (if not already exists)
RUN groupadd -g 1000 node 2>/dev/null || true && \
    useradd -u 1000 -g node -m node 2>/dev/null || true

WORKDIR /app

# Copy package files
COPY --chown=node:node package*.json ./

# Install ALL dependencies (including dev) for mastra dev
RUN npm install --legacy-peer-deps && \
    chown -R node:node /app/node_modules

# Copy source code
COPY --chown=node:node . .

# Build the project
RUN npm run build

# Create logs directory and fix ownership of .mastra directory
RUN mkdir -p /app/logs && chown -R node:node /app/logs /app/.mastra /app/node_modules/@mastra

# Switch to non-root user
USER node

# Expose ports
EXPOSE 4111 5000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:5000', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})" || exit 1

# Start with mastra dev for playground
CMD ["npm", "run", "dev"]