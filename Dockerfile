FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
COPY --chown=node:node package.json server.mjs ./
COPY --chown=node:node dist ./dist
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
