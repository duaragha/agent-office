# Agent office hub: the built client plus a small Node server (ws is its only
# runtime dependency; everything the browser needs is bundled by Vite).
FROM node:24.15.0-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

FROM node:24.15.0-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server ./server
COPY src/shared ./src/shared
COPY --from=build /src/dist ./dist
USER node
EXPOSE 8825
CMD ["node", "server/hub.mjs"]
