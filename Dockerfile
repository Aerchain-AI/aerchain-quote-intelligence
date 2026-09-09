# Single image, single process, single port: the API serves the built front end,
# so the whole prototype is one URL with nothing to install.
FROM node:22-slim

# openssl is Prisma's runtime dependency; the engine is generated inside this
# image so it always matches this OS.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Manifests first, so a dependency install is only redone when they change.
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY services/api/package.json services/api/
COPY apps/web/package.json apps/web/
RUN npm install

COPY . .

# Absolute, because the working directory differs between the Prisma CLI at
# build time and the server at run time. bootstrap.ts restores demo.db to this
# exact path on a cold start.
ENV DATABASE_URL="file:/app/services/api/prisma/dev.db"
ENV NODE_ENV=production

# Builds the shared package, generates the Prisma client, compiles the API and
# bundles the front end into apps/web/dist.
RUN npm run build

# GEMINI_API_KEYS is intentionally NOT baked in. Set it in the host's
# environment so the key never lives in the image or the repository.
ENV PORT=4000
EXPOSE 4000

CMD ["npm", "start"]
