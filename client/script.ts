// file uploader. When file has been uploaded, submit the form
(document.getElementById('file-upload') as HTMLInputElement).onchange = () => {
    (document.getElementById('upload-form') as HTMLFormElement).submit();
};

// pictures
const picturesContainer = document.getElementById('pictures-container')!;
const nbPictures = 6;
const imagePath =
    window.location.pathname !== '/'
        ? `uploads${window.location.pathname}`
        : 'img/doge.png';
for (let i = nbPictures; i >= 1; i--) {
    const img = document.createElement('img');
    img.setAttribute('src', imagePath);
    img.setAttribute('class', 'hide');
    img.setAttribute('id', `pict${i}`);
    picturesContainer.appendChild(img);
}

// video element
const video = document.getElementById('video') as HTMLVideoElement;
// set video volume to 5%
video.volume = 0.05;
// once the video has ended, fade it out then restart the animation
video.addEventListener(
    'ended',
    () => {
        video.classList.add('fade-out');
        video.addEventListener(
            'transitionend',
            () => {
                video.classList.remove('fade-out');
                restartAnimation();
            },
            { once: true },
        );
    },
    false,
);

const tapToPlay = document.getElementById('tap-to-play') as HTMLElement;
const tapToPlayText = '✦ Press to fly ✦';

// boolean to know if animation is ongoing
let animationOnGoing = false;

// init animation
restartAnimation();

/**
 * Restart the event (automatic if desktop, manually if mobile)
 */
function restartAnimation() {
    // animation is terminated
    animationOnGoing = false;
    video.style.display = 'none';

    // don't allow launching until the video is actually loaded, so the
    // animation can never run ahead of a video that isn't ready yet
    tapToPlay.style.display = 'block';
    if (video.readyState >= video.HAVE_ENOUGH_DATA) {
        tapToPlay.innerHTML = `<p>${tapToPlayText}</p>`;
        window.addEventListener('touchend', startAnimation);
        window.addEventListener('click', startAnimation);
    } else {
        tapToPlay.innerHTML = '<p>⌛ Loading…</p>';
        video.addEventListener('canplaythrough', restartAnimation, {
            once: true,
        });
    }
}

type AnimationStage = {
    class: string;
    pictures: string[];
};

/**
 * Start the shooting stars animation
 * @param  e  JS event
 */
function startAnimation(e: Event) {
    if (animationOnGoing) return;

    // if we clicked on a link or a button, don't start
    if (['A', 'INPUT', 'LABEL'].includes((e.target as HTMLElement).tagName))
        return;

    (document.getElementById('tap-to-play') as HTMLElement).style.display =
        'none';
    video.style.display = 'block';

    // animation is starting
    animationOnGoing = true;

    // play the background video
    video.play();

    // times and classes associated with images
    const times: Record<number, AnimationStage> = {
        0: {
            class: 'init',
            pictures: [],
        },
        3900: {
            class: 'spaceone',
            pictures: ['pict1'],
        },
        7700: {
            class: 'dolphins',
            pictures: ['pict1', 'pict2'],
        },
        11600: {
            class: 'spacetwo',
            pictures: ['pict1', 'pict2', 'pict3', 'pict4', 'pict5', 'pict6'],
        },
        15500: {
            class: 'dark',
            pictures: [],
        },
        17100: {
            class: 'microone',
            pictures: ['pict1'],
        },
        19300: {
            class: 'microtwo',
            pictures: ['pict1'],
        },
        24800: {
            class: 'init',
            pictures: [],
        },
    };

    // pictures classes
    const pictures = ['pict1', 'pict2', 'pict3', 'pict4', 'pict5', 'pict6'];

    // main loop for class change events
    for (const time in times) {
        setTimeout(() => {
            // foreach pictures
            for (let i = pictures.length - 1; i >= 0; i--) {
                const img = document.getElementById(pictures[i])!;
                // if the picture is in the current animation array, add the correct class
                if (times[Number(time)].pictures.indexOf(pictures[i]) > -1) {
                    img.className = `${times[Number(time)].class}_${i + 1}`;
                } else {
                    // else, hide the picture
                    img.className = 'hide';
                }
            }
        }, Number(time));
    }
}
