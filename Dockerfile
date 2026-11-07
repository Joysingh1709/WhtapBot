FROM node:22-slim
# ffmpeg converts audio to OGG/Opus so uploads can be sent as real WhatsApp voice notes.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
ENV HOST=0.0.0.0 PORT=3000 DATA_DIR=/data
# Mount a persistent volume at /data: it holds the WhatsApp session, the message queue, attachments and backups.
VOLUME /data
EXPOSE 3000
CMD ["node", "--no-warnings", "src/server.js"]
