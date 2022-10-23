FROM node:16-alpine

WORKDIR /code

COPY server.js package.json /code/
COPY public/index.html /code/public/
COPY public/css /code/public/css/
COPY public/img /code/public/img/
COPY public/videos /code/public/videos/
COPY public/js/script.min.js /code/public/js/

RUN cd /code && npm install --omit=dev

ENTRYPOINT ["node", "/code/server.js"]