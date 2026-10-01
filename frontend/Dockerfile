# syntax=docker/dockerfile:1

# ---------- 1) Build estático con Vite ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN npm run build

# ---------- 2) Servido por nginx SIN root (hallazgo H-3) ----------
# Imagen oficial no privilegiada: corre como uid 101 (nginx) y escucha en 8080.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
ENV BACKEND_URL=http://backend:3000

# El entrypoint procesa las plantillas (envsubst) y vuelca el resultado en conf.d.
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

# USER 101 ya viene fijado por la imagen base (no root).
EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ > /dev/null || exit 1
