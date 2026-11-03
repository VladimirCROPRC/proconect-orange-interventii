FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production \
    WRANGLER_LOG_PATH=/tmp/wrangler.log \
    WRANGLER_WRITE_LOGS=false

COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY . .
RUN chmod +x scripts/*.sh \
    && npm run build

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/session').then(r=>{if(r.status>=500)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["./scripts/server-entrypoint.sh"]
