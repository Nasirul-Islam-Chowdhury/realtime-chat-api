FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/database/migrate.ts ./src/database/migrate.ts
COPY tsconfig.json ./
RUN npm install ts-node tsconfig-paths --save-dev
EXPOSE 3000
CMD ["node", "dist/main"]
