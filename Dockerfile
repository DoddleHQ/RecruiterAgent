# Production Dockerfile with non-root user
FROM node:20-alpine

# Create non-root user
RUN addgroup -g 1000 node && \
    adduser -D -u 1000 -G node node

WORKDIR /app

# Copy package files
COPY --chown=node:node package*.json ./

# Install ALL dependencies (including dev) for mastra dev
RUN npm ci

# Copy source code
COPY --chown=node:node . .

# Build the project
RUN npm run build

# Create logs directory
RUN mkdir -p /app/logs && chown -R node:node /app/logs

# Switch to non-root user
USER node

# Expose ports
EXPOSE 4111 5000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:5000', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})" || exit 1

# Start with mastra dev for playground
CMD ["npm", "run", "dev"]