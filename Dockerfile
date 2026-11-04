FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# Read by dist/scripts/migrate.js (the one-shot `migrate` compose service).
COPY database ./database
# Demo page served at / when DEMO_LOGIN_ENABLED=true.
COPY public ./public
USER node
EXPOSE 3000
CMD ["node", "dist/src/main.js"]
