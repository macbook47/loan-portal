# Build stage: compile the React app
FROM registry.access.redhat.com/ubi9/nodejs-20:latest AS build
USER 0
WORKDIR /src
COPY package.json ./
RUN npm install
COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

# Runtime stage: Red Hat nginx, non-root on 8080
FROM registry.access.redhat.com/ubi9/nginx-122:latest
USER 0
COPY nginx.conf.tmpl /opt/app-root/etc/nginx.conf.tmpl
COPY --from=build /src/dist /opt/app-root/src
RUN chmod -R g+rwX /opt/app-root/src
USER 1001
EXPOSE 8080
# API_UPSTREAM: host:port of the API Service.  APP_TITLE: name shown in the header.
ENV API_UPSTREAM=loan-api:9000 \
    APP_TITLE="Loan Portal"
CMD ["/bin/sh", "-c", "sed -e \"s|__API_UPSTREAM__|${API_UPSTREAM}|g\" -e \"s|__APP_TITLE__|${APP_TITLE}|g\" /opt/app-root/etc/nginx.conf.tmpl > /tmp/nginx.conf && exec nginx -c /tmp/nginx.conf -g 'daemon off;'"]
