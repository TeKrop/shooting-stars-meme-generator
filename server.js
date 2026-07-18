'use strict';

/*************** SET UP ***************/
require('dotenv').config();                                  // environment variables
const NODE_ENV = process.env.NODE_ENV || 'prod';             // environment (dev/prod)
const HTTP_PORT = parseInt(process.env.HTTP_PORT || 9595);   // http port of the server
const HASH_LENGTH = parseInt(process.env.HASH_LENGTH || 5);  // hash length for uploaded images URL

const path = require('path');                   // path helpers
const express  = require('express');            // express
const multer  = require('multer');              // middleware for handling file uploads
const compression = require('compression');     // gzip or deflate compression for page loading
const helmet = require('helmet');               // security for production
const app = express();                          // create our app w/ express
const morgan = require('morgan');               // log requests to the console (express4)
const randomstring = require('randomstring');   // generate random strings

/*************** CONFIG ***************/
app.use(compression());                          // compress all requests
if (NODE_ENV !== 'dev') {
    app.use(helmet());                           // security for well-known web vulnerabilities (CSP blocks Vite's HMR websocket in dev)
}
app.use(morgan('dev'));                          // log every request to the console

// uploaded images are runtime data, outside Vite's build output, served the same way in dev & prod
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// initialize and configure multer storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, 'uploads'));
  },
  filename: function (req, file, cb) {
    cb(null, randomstring.generate(HASH_LENGTH));
  }
});
const upload = multer({
    storage: storage,
    fileFilter: function(req, file, cb) { // filter with only images mimetypes
        cb(null, /^image\/.+$/.test(file.mimetype));
    }
});

/*************** UPLOAD ROUTE ***************/
app.post('/upload', upload.single('file-upload'), function(req, res) {
    // if file upload was a success
    if (req.file) {
        // the filename will be the unique hash for retrieving it
        res.redirect('/' + req.file.filename);
    } else {
        res.redirect('/');
        console.log('error, file is not an image');
    }
});

/*************** FRONTEND + LISTEN ***************/
async function start() {
    if (NODE_ENV === 'dev') {
        // start listening first so Vite's HMR websocket can attach to the same
        // HTTP server/port, instead of opening its own separate port
        const httpServer = app.listen(HTTP_PORT);

        // Vite dev server embedded as middleware: LESS/JS are compiled on the fly, with HMR
        const { createServer } = require('vite');
        const vite = await createServer({
            root: __dirname,
            server: { middlewareMode: true, hmr: { server: httpServer } },
            appType: 'custom'
        });
        app.use(vite.middlewares);

        app.get('/{*splat}', async function(req, res, next) {
            try {
                const fs = require('fs');
                const template = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');
                const html = await vite.transformIndexHtml(req.originalUrl, template);
                res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
            } catch (e) {
                vite.ssrFixStacktrace(e);
                next(e);
            }
        });
    } else {
        // production: serve the pre-built, minified bundle from dist/
        app.use(express.static(path.join(__dirname, 'dist')));
        app.get('/{*splat}', function(req, res) {
            res.sendFile('index.html', { root: path.join(__dirname, 'dist') });
        });
        app.listen(HTTP_PORT);
    }

    console.log('Listening on port ' + HTTP_PORT + ' with HTTP (' + NODE_ENV + ' mode)');
}

start();
