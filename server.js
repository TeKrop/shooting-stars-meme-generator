'use strict';

/*************** SET UP ***************/
require('dotenv').config();                                  // environment variables
const NODE_ENV = process.env.NODE_ENV || 'prod';             // environment (dev/prod)
const HTTP_PORT = parseInt(process.env.HTTP_PORT || 9595);   // http port of the server
const HASH_LENGTH = parseInt(process.env.HASH_LENGTH || 5);  // hash length for uploaded images URL

const fs = require('fs');                       // filesystem, to save/load files
const express  = require('express');            // express
const multer  = require('multer');              // middleware for handling file uploads
const compression = require('compression');     // gzip or deflate compression for page loading
const helmet = require('helmet');               // security for production
const app = express();                          // create our app w/ express
const morgan = require('morgan');               // log requests to the console (express4)
const randomstring = require('randomstring');   // generate random strings

let watch, exec, minify, uglifyjs, yui;
if (NODE_ENV === 'dev') {
    watch = require('node-watch');                // watch files or directories for changes
    exec = require('child_process').exec;         // launch process from code
    minify = require('@node-minify/core');        // tool for minifying CSS and JS
    uglifyjs = require('@node-minify/uglify-js'); // compressor for JS
    yui = require('@node-minify/yui');            // compressor for JS
}

/*************** CONFIG ***************/
app.use(compression());                          // compress all requests
app.use(helmet());                               // security for well-known web vulnerabilities
app.use(express.static(__dirname + '/public'));  // set the static files location
app.use(morgan('dev'));                          // log every request to the console

// initialize and configure multer storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, __dirname + '/public/uploads');
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

/*************** WATCH ***************/

if (NODE_ENV === 'dev') {
    // watch main.less for changes, and compile when the file changes
    watch('public/less/style.less', function(e, filename) {
        console.log('[node-watch]', filename, 'changed. Compiling...');
        // we render the main.less file into main.css (minified)
        exec("lessc public/less/style.less public/css/style.min.css", function(error, stdout, stderr) {
            console.log('[node-watch] style.css file compiled. Running compression...');
            if (stdout !== '') {
                console.log('[node-watch] stdout: ' + stdout);
            }
            if (stderr !== '') {
                console.log('[node-watch] stderr: ' + stderr);
            }
            if (error !== null) {
                console.log('[node-watch] exec error: ' + error);
            }
            // and we compress using yui compressor
            minify({
                compressor: yui,
                type: 'css',
                input: [
                    'public/css/style.min.css'
                ],
                output: 'public/css/style.min.css',
                callback: function(err, min) {
                    console.log('[node-watch] style.css minification done !');
                    if (err !== null) {
                        console.log(err);
                    }
                }
            });
        });
    });

    // watch js relative to angular changes, and compile js
    watch('public/js/script.js', function(e, filename) {
        console.log('[node-watch]', filename, 'changed. Compiling js files...');
        minify({
            compressor: uglifyjs,
            input: [
                'public/js/script.js'
            ],
            output: 'public/js/script.min.js',
            callback: function(err, min) {
                console.log('[node-watch] script.min.js compilation done !');
                if (err !== null) {
                    console.log(err);
                }
            }
        });
    });
}

/*************** LISTEN ***************/
app.listen(HTTP_PORT);
console.log('Listening on port ' + HTTP_PORT + ' with HTTP (' + NODE_ENV + ' mode)');

/*************** ROUTES ***************/

/********** UPLOAD ROUTE **********/
app.post('/upload', upload.single('file-upload'), function(req, res, next) {
    // if file upload was a success
    if (req.file) {
        // the filename will be the unique hash for retrieving it
        res.redirect('/' + req.file.filename);
    } else {
        res.redirect('/');
        console.log('error, file is not an image');
    }
});

/********** OTHER ROUTES **********/
app.get('*', function(req, res) {
    // load the single view file
    res.sendFile('index.html', { root: __dirname + '/public' });
});
