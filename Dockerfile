FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
ENV HOST=0.0.0.0 PORT=3000 DATA_DIR=/data
# Mount a persistent volume at /data: it holds the WhatsApp session and the message queue.
VOLUME /data
EXPOSE 3000
CMD ["node", "src/server.js"]
