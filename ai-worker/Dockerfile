FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "console.log('worker alive')" || exit 1
CMD ["node", "src/worker.js"]