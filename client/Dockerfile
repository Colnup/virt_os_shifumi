FROM node:slim

RUN npm install -g pnpm

WORKDIR /app/client
COPY package*.json ./

RUN pnpm install

COPY . .

CMD [ "pnpm", "run", "start" ]