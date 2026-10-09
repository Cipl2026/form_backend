FROM node:20-alpine


WORKDIR /app


COPY package*.json ./


RUN npm install


COPY . .
RUN npm run build


ENV NODE_ENV=production


EXPOSE 2000



HEALTHCHECK \
--interval=30s \
--timeout=5s \
--start-period=15s \
--retries=3 \
CMD ps aux | grep node | grep -v grep || exit 1



CMD ["sh","-c","node dist/server.js"]
