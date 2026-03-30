# ── Build Stage ──
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production=false

COPY . .

# Build-time env: the public URL the browser uses to reach the API
ARG REACT_APP_BACKEND_URL=""
ENV REACT_APP_BACKEND_URL=$REACT_APP_BACKEND_URL

RUN yarn build

# ── Serve Stage ──
FROM nginx:1.25-alpine

LABEL maintainer="Singra Vox" \
      description="Singra Vox Web Client"

COPY --from=build /app/build /usr/share/nginx/html
COPY ../deploy/nginx/default.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget -q --spider http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
