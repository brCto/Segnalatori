FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server.js db.js demo.js ./
COPY public ./public
RUN mkdir -p /app/data && chown -R node:node /app
USER node
ENV PORT=8765 HOST=0.0.0.0 DATA_DIR=/app/data
VOLUME ["/app/data"]
EXPOSE 8765
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8765/healthz >/dev/null || exit 1
CMD ["node", "server.js"]
