# Source: https://raw.githubusercontent.com/bri0/powerplate/master/Dockerfile
FROM node:16-buster-slim as build

RUN apt-get update
RUN npm install -g pnpm@7.5.0
# use changes to package.json to force Docker not to use the cache
# when we change our application's nodejs dependencies:
COPY package.json pnpm-lock.yaml /tmp/
RUN cd /tmp && pnpm install --prod=false --frozen-lockfile
RUN mkdir -p /app && mv /tmp/node_modules /app

# build bot
WORKDIR /app
COPY . /app
ENV NODE_ENV production
RUN pnpm build

FROM node:16-buster-slim as deps

# use changes to package.json to force Docker not to use the cache
# when we change our application's nodejs dependencies:
RUN npm install -g pnpm@7.5.0
COPY package.json pnpm-lock.yaml /tmp/
RUN cd /tmp && pnpm install --prod=true --frozen-lockfile --shamefully-hoist

FROM node:16-alpine3.15
WORKDIR /app
COPY . /app
COPY --from=build /app/dist ./dist/
COPY --from=deps /tmp/node_modules ./node_modules/

CMD ["yarn", "start"]
