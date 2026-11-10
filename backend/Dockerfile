FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev && npm install prisma@^6.1.0
COPY prisma ./prisma
COPY src ./src
RUN npx prisma generate
EXPOSE 3001
CMD ["sh", "-c", "npx prisma db push && node prisma/seed.js && node src/server.js"]
