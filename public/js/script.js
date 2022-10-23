'use strict';
// file uploader. When file has been uploaded, submit the form
document.getElementById('file-upload').onchange = function() {
    document.getElementById('upload-form').submit();
};

// pictures
var picturesContainer = document.getElementById('pictures-container');
var nbPictures = 6;
var imagePath = (window.location.pathname !== '/') ? 'uploads' + window.location.pathname : 'img/doge.png';
for (var i = nbPictures; i >= 1; i--) {
    var img = document.createElement('img');
    img.setAttribute('src', imagePath);
    img.setAttribute('class', 'hide');
    img.setAttribute('id', 'pict' + i);
    picturesContainer.appendChild(img);
}

// video element
var video = document.getElementById('video');
// set video volume to 5%
video.volume = 0.05;
// once the video has ended, restart the animation
video.addEventListener('ended', restartAnimation, false);

// if mobile, wait for user to tap before launching. else, start on page load
if (/Mobi/i.test(navigator.userAgent) || /Android/i.test(navigator.userAgent)) {
    document.getElementById('tap-to-play').innerHTML ='<p>Tap the screen to play :)</p>';
}

// boolean to know if animation is ongoing
var animationOnGoing = false;

// init animation
restartAnimation();

/**
 * Restart the event (automatic if desktop, manually if mobile)
 * @param  Event  e  JS event
 */
function restartAnimation(e) {
    // animation is terminated
    animationOnGoing = false;

    // show the text
    document.getElementById('tap-to-play').style.display = 'block';
    video.style.display = 'none';

    // we user finished to tap
    window.addEventListener('touchend', startAnimation);
    window.addEventListener('click', startAnimation);
}

/**
 * Start the shooting stars animation
 * @param  Event  e  JS event
 */
let test = null;
function startAnimation(e) {
    if (animationOnGoing) return;

    // if we clicked on a link or a button, don't start
    if (['A', 'INPUT', 'LABEL'].includes(e.target.tagName)) return;

    document.getElementById('tap-to-play').style.display = 'none';
    video.style.display = 'block';

    // animation is starting
    animationOnGoing = true;

    // play the background video
    video.play();

    // times and classes associated with images
    var times = {
        0: {
            class: 'init',
            pictures: []
        },
        3900: {
            class: 'spaceone',
            pictures: ['pict1']
        },
        7700: {
            class: 'dolphins',
            pictures: ['pict1', 'pict2']
        },
        11600: {
            class: 'spacetwo',
            pictures: ['pict1', 'pict2', 'pict3', 'pict4', 'pict5', 'pict6']
        },
        15500: {
            class: 'dark',
            pictures: []
        },
        17100: {
            class: 'microone',
            pictures: ['pict1']
        },
        19300: {
            class: 'microtwo',
            pictures: ['pict1']
        },
        24800: {
            class: 'init',
            pictures: []
        }
    };

    // pictures classes
    var pictures = [
        'pict1', 'pict2', 'pict3', 'pict4', 'pict5', 'pict6'
    ];

    // main loop for class change events
    for (var time in times) {
        (function (time) {
            setTimeout(function() {
                // foreach pictures
                for (var i = pictures.length - 1; i >= 0; i--) {
                    var img = document.getElementById(pictures[i]);
                    // if the picture is in the current animation array, add the correct class
                    if (times[time].pictures.indexOf(pictures[i]) > -1) {
                        img.className = times[time].class + '_' + (i+1);
                    } else { // else, hide the picture
                        img.className = 'hide';
                    }
                }
            }, time);
        }).call(this, time);
    }
}
