FROM node:22-alpine AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM golang:1.24-alpine AS backend
WORKDIR /build
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /dino-server .

FROM alpine:3.21
RUN apk add --no-cache ca-certificates && adduser -D -u 10001 dino
WORKDIR /app/backend
COPY --from=frontend /app/dist /app/dist
COPY --from=frontend /app/public/game-data.json /app/public/game-data.json
COPY --from=backend /dino-server ./server
ENV PORT=10000
ENV GAME_DATA_PATH=/app/public/game-data.json
ENV FRONTEND_DIR=/app/dist
USER dino
EXPOSE 10000
CMD ["./server"]
