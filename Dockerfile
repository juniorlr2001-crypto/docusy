FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    fonts-dejavu-core \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ENV DOCU_AUTO_UPLOAD=true
ENV DOCU_CLEAN_WORK=true

CMD ["npm", "run", "generate:cloud"]
