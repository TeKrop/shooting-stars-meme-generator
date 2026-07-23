import { initPreviewDialog } from './preview';

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
// once the video has ended, restart the animation
video.addEventListener('ended', restartAnimation, false);

const landing = document.getElementById('landing') as HTMLElement;
const starfield = document.getElementById('starfield') as HTMLElement;
const tapToPlay = document.getElementById('tap-to-play') as HTMLElement;
const tapToPlayText =
    '<span class="spark">✦</span> Press to fly <span class="spark">✦</span>';

// pending setTimeout ids for the current run's picture choreography, so a
// restart (e.g. uploading a new image mid-flight) can cancel them instead
// of leaving them to fire later and stomp on the new run's classes
let animationTimeouts: ReturnType<typeof setTimeout>[] = [];

// showLaunchPrompt() re-runs on every restart (video 'ended', or a fresh
// upload) — this guards against re-attaching the click/touchend listeners
// each time, which would otherwise fire startAnimation multiple times per
// tap. Can't just attach them once unconditionally at module load instead:
// they're deliberately gated behind the video being ready (see below).
let launchListenersAttached = false;

// init animation
restartAnimation();

initPreviewDialog(applyUploadedImage);

/**
 * Swaps in a freshly uploaded image without a full page reload: updates the
 * pictures' src, updates the URL to match (so the link stays shareable),
 * and launches the animation right away so the upload feels instant.
 */
function applyUploadedImage(hash: string) {
    const src = `uploads/${hash}`;
    for (let i = 1; i <= nbPictures; i++) {
        (document.getElementById(`pict${i}`) as HTMLImageElement).src = src;
    }
    history.pushState(null, '', `/${hash}`);
    startAnimation();
}

/**
 * Restart the event (automatic if desktop, manually if mobile)
 */
function restartAnimation() {
    video.style.display = 'none';
    showLaunchPrompt();
}

/**
 * Don't allow launching until the video is actually loaded, so the
 * animation can never run ahead of a video that isn't ready yet
 */
function showLaunchPrompt() {
    landing.style.display = 'flex';
    landing.classList.remove('fade-out');
    starfield.classList.remove('fade-out');
    if (video.readyState >= video.HAVE_CURRENT_DATA) {
        tapToPlay.innerHTML = `<p>${tapToPlayText}</p>`;
        // scoped to the prompt itself, not the whole page — only clicking/
        // tapping this specific element launches the animation (being a
        // real <button> also gets Enter/Space handling for free)
        if (!launchListenersAttached) {
            tapToPlay.addEventListener('touchend', startAnimation);
            tapToPlay.addEventListener('click', startAnimation);
            launchListenersAttached = true;
        }
    } else {
        tapToPlay.innerHTML = '<p>⌛ Loading…</p>';
        video.addEventListener('loadeddata', showLaunchPrompt, {
            once: true,
        });
    }
}

type AnimationStage = {
    class: string;
    pictures: string[];
};

/**
 * Start the shooting stars animation — always (re)starts cleanly, so
 * calling it while a run is already ongoing (e.g. uploading a new image
 * mid-flight) restarts from "init" with the new image instead of just
 * swapping the picture src underneath whatever's currently flying.
 */
function startAnimation() {
    // cancel any still-pending choreography from a previous run so it can't
    // fire later and stomp on this run's classes
    animationTimeouts.forEach((id) => {
        clearTimeout(id);
    });
    animationTimeouts = [];

    // fades out rather than vanishing instantly, so the console visibly
    // hands off to the image that flies in during the "init" stage below
    landing.classList.add('fade-out');
    starfield.classList.add('fade-out');
    video.style.display = 'block';

    // play the background video from the start, even if a previous run
    // left it mid-playback
    video.currentTime = 0;
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
        const id = setTimeout(() => {
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
        animationTimeouts.push(id);
    }
}
