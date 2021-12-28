'use strict';

/*************** SET UP ***************/
const fs = require('fs');                          // filesystem, to save/load files
const express  = require('express');               // express
const multer  = require('multer');                 // middleware for handling file uploads
const compression = require('compression');        // gzip or deflate compression for page loading
const helmet = require('helmet');                  // security for production
const app = express();                             // create our app w/ express
const morgan = require('morgan');                  // log requests to the console (express4)
const exec = require('child_process').exec;        // launch process from code
const watch = require('node-watch');               // watch files or directories for changes
const compressor = require('node-minify');         // tool for minifying CSS and JS
const randomstring = require('randomstring');      // generate random strings
const httpPort = 9595;                             // port to use

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
    cb(null, randomstring.generate(7));
  }
});
const upload = multer({
    storage: storage,
    fileFilter: function(req, file, cb) { // filter with only images mimetypes
        cb(null, /^image\/.+$/.test(file.mimetype));
    }
});

/*************** LISTEN ***************/
app.listen(httpPort);
console.log('Listening on port ' + httpPort + ' with HTTP');

/*************** IMAGES DATA ***************/
function saveImagesData(res = false, hash = false) {
    fs.writeFile(__dirname + '/data/images.json', JSON.stringify(images), function(err) {
        if (err) {
            throw err;
            process.exit(1);
        }
        if (res && hash) {
            res.redirect('/' + hash);
        } else {
            console.log('Images data file created !');
        }
    });
}

let images = [];
fs.readFile(__dirname + '/data/images.json', 'utf8', function (err, data) {
    if (err) {
        console.log('Images data file not found. Creating it...');
        saveImagesData();
    } else {
        images = JSON.parse(data);
    }
});

/*************** WATCH ***************/
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
        compressor.minify({
            compressor: 'yui-css',
            input: [
                'public/css/style.min.css'
            ],
            output: 'public/css/style.min.css',
            callback: function(err, min){
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
    compressor.minify({
        compressor: 'uglifyjs',
        input: [
            'public/js/script.js'
        ],
        output: 'public/js/script.min.js',
        callback: function(err, min){
            console.log('[node-watch] script.min.js compilation done !');
            if (err !== null) {
                console.log(err);
            }
        }
    });
});

/*************** ROUTES ***************/

/********** UPLOAD ROUTE **********/
app.post('/upload', upload.single('file-upload'), function(req, res, next) {
    // if file upload was a success
    if (req.file) {
        // generate a hash and store it in json data with filename
        images.push(req.file.filename);
        saveImagesData(res, req.file.filename);
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
