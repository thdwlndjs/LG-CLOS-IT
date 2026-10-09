FROM mcr.microsoft.com/playwright:v1.64.0-noble@sha256:06a9939e57531807f8d5fd76ce44b53165ffb7d7501d87ab10e285c20b1e971f
WORKDIR /app
COPY renderer/package.json renderer/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY renderer/src ./src
COPY renderer/test ./test
USER pwuser
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "src/server.mjs"]
