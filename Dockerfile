FROM node:24-bookworm-slim AS web
WORKDIR /build
RUN npm install --global pnpm@11.25.0
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web ./web
COPY vite.config.js ./
COPY scripts/check_web_bundle.mjs ./scripts/check_web_bundle.mjs
RUN pnpm build
RUN pnpm prune --prod

FROM python:3.13-slim-bookworm
COPY --from=web /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 libatomic1 ca-certificates && rm -rf /var/lib/apt/lists/*
COPY requirements.txt requirements-backup.txt ./
RUN pip install --no-cache-dir -r requirements.txt && useradd --uid 10001 --create-home flow
COPY --from=web /build/node_modules ./node_modules
COPY --from=web /build/dist ./dist
COPY *.py ./
COPY server ./server
COPY evaluation ./evaluation
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 PYTHON_BIN=python3 PYTHONDONTWRITEBYTECODE=1 OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1
USER flow
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=30s --start-period=60s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","server/index.mjs"]
