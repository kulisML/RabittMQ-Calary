FROM node:20-alpine

# Install docker CLI so gateway can use 'docker exec' for file sync
RUN apk add --no-cache docker-cli

WORKDIR /app

COPY package.json .
RUN npm install --production

COPY . .

EXPOSE 3001

CMD ["node", "src/index.js"]
