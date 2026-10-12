FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd -g 1000 node 2>/dev/null || true && \
    useradd -u 1000 -g node -m node 2>/dev/null || true

WORKDIR /app

COPY --chown=node:node package*.json ./

RUN npm install --legacy-peer-deps && \
    chown -R node:node /app/node_modules

COPY --chown=node:node . .

RUN npm run build

RUN mkdir -p /app/logs && chown -R node:node /app/logs /app/.mastra /app/node_modules/@mastra

USER node

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:5000', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})" || exit 1

CMD ["npm", "start"]
