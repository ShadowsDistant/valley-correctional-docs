# Valley Correctional Facility docs — production image
FROM node:20-bookworm-slim

# better-sqlite3 compiles a native addon; provide the build toolchain.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
WORKDIR /app

# Install dependencies first for better layer caching.
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

# Copy the application source.
COPY . .

# SQLite database + WAL files live here; mount a volume to persist them.
RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 3000
CMD ["node", "server.js"]
