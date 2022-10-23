# 🐶 Shooting Stars Meme Generator

![Version](https://img.shields.io/github/package-json/v/TeKrop/shooting-stars-meme-generator)
[![Issues](https://img.shields.io/github/issues/TeKrop/shooting-stars-meme-generator)](https://github.com/TeKrop/shooting-stars-meme-generator/issues)
[![License: MIT](https://img.shields.io/github/license/TeKrop/shooting-stars-meme-generator)](https://github.com/TeKrop/shooting-stars-meme-generator/blob/master/LICENSE)

![Shootings Star Meme Generator](https://files.tekrop.fr/shooting-stars.jpg)

> Shooting Stars Meme Generator using CSS animations, use your own images and have fun ! 

## Table of contents
* [✨ Demo](#-demo)
* [💽 Installation](#-installation)
* [🐋 Docker](#-docker)
* [🤝 Contributing](#-contributing)
* [📝 License](#-license)

## ✨ [Demo](https://shooting-stars.tekrop.fr)

You can see and use a live version of the service here : https://shooting-stars.tekrop.fr/. If you want to use the service, and you have the possibility to host your own instance, please do it (at least for production environment), in order to not overload the live version i'm hosting.

## 💽 Installation

```sh
npm install
node server.js
```

## 🐋 Docker

### Compose
```
docker compose up -d
```

### Classic
```
docker build . -t tekrop/shooting-stars-meme-generator:latest
docker run -d \
	--name shooting-stars-meme-generator \
	-p 80:9595 \
	--volume /local_path_to_uploads:/code/public/uploads \
	tekrop/shooting-stars-meme-generator
```

## 🤝 Contributing

Contributions, issues and feature requests are welcome!

Feel free to check [issues page](https://github.com/TeKrop/shooting-stars-meme-generator/issues).

## 📝 License

Copyright © 2017-2022 [Valentin PORCHET](https://github.com/TeKrop).

This project is [MIT](https://github.com/TeKrop/shooting-stars-meme-generator/blob/master/LICENSE) licensed.

***
_This README was generated with ❤️ by [readme-md-generator](https://github.com/kefranabg/readme-md-generator)_
