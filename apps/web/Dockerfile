FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm install

COPY . .

EXPOSE 5173

CMD ["sh", "-c", "npm run build --workspace @bubble-craps/web && npm run start --workspace @bubble-craps/web"]
