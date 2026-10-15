# Build from the repo root: docker build -f backend/Dockerfile .
# (npm workspaces share one lockfile at the root.)

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci -w backend
COPY backend backend
RUN npm run build -w backend

FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci -w backend --omit=dev && npm cache clean --force
COPY --from=build /app/backend/dist backend/dist
USER node
EXPOSE 3001
CMD ["node", "backend/dist/main.js"]
