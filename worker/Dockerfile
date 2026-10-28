FROM mcr.microsoft.com/playwright:v1.64.1-noble
USER root
RUN apt-get update && apt-get install -y --no-install-recommends iptables util-linux && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY worker ./worker
COPY src/lib/network-policy.ts ./src/lib/network-policy.ts
RUN chmod 755 /app/worker/egress-browser-entrypoint.sh
