# Lets Glama (and any container host) build + run the stdio bridge so it can
# introspect the server. The bridge has zero dependencies and forwards to
# https://mcp.cityparity.com/mcp by default, so no install or env is needed.
FROM node:20-alpine
WORKDIR /app
COPY . .
ENTRYPOINT ["node", "bin/cityparity-mcp.mjs"]
