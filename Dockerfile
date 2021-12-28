FROM debian:bullseye

CMD ["bash", "/opt/shooting-stars-meme-generator/app.sh"]

RUN apt update \
    && apt install -y --no-install-recommends apt-transport-https apt-utils ca-certificates curl \
    && curl -fsSL https://deb.nodesource.com/setup_16.x | bash - \
    && apt install -y --no-install-recommends nodejs build-essential git \
    && cd /opt/ \
    && git clone https://github.com/TeKrop/shooting-stars-meme-generator.git \
    && cd shooting-stars-meme-generator \
    && npm install \
    && npm install -g nodemon \
    && rm -rf /var/lib/{apt,dpkg,cache,log}/ /tmp/* /var/tmp/*