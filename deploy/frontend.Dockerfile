# ── Build Stage ──
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json yarn.lock ./
RUN corepack enable && yarn install --production=false

COPY . .

RUN yarn build

# ── Serve Stage ──
FROM nginx:1.25-alpine

LABEL maintainer="Singra Vox" \
      description="Singra Vox Web Client"

COPY --from=build /app/build /usr/share/nginx/html
COPY nginx.default.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget -q --spider http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
