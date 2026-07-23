// ============================================================
// SyncStep — practice.html
// Initializes the YouTube IFrame Player API and the MediaPipe
// Pose Landmarker, then syncs a reference skeleton overlay to
// YouTube playback and runs live pose detection on the webcam.
// ============================================================

import {
  PoseLandmarker,
  FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest";

import { db } from "/firebase-init.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// ---- Shared state -------------------------------------------------
let ytPlayer;                 // YouTube player instance
let poseLandmarker;            // MediaPipe Pose Landmarker instance
let skeletonData = null;       // reference skeleton JSON for the current dance
let currentDance = null;       // the dances/{danceId} Firestore document data
let syncIntervalId = null;     // handle for the reference-sync polling loop
let webcamLoopActive = false;  // guards the live-detection requestAnimationFrame loop
let webcamStream = null;       // active MediaStream, kept so its tracks can be stopped

// Only runs on practice.html (these elements won't exist on other pages)
const referenceCanvas = document.getElementById('reference-overlay');
const liveCanvas = document.getElementById('live-overlay');
const webcamVideoEl = document.getElementById('webcam-feed');
const startCameraBtn = document.getElementById('start-camera-btn');
const stopCameraBtn = document.getElementById('stop-camera-btn');

// ============================================================
// 1. YOUTUBE IFRAME API
// ============================================================

// YouTube's script calls this automatically on window once it has loaded —
// name and signature are fixed by the API, don't rename this function. It
// can't be declared async itself, so it delegates to an async helper.
window.onYouTubeIframeAPIReady = function () {
  if (!document.getElementById('yt-player')) return; // not on practice.html
  loadDanceAndCreatePlayer();
};

async function loadDanceAndCreatePlayer() {
  const params = new URLSearchParams(window.location.search);
  const danceId = params.get('dance'); // set by library.html's card links

  if (!danceId) {
    console.error('No ?dance=<id> in the URL — nothing to load.');
    return;
  }

  const danceSnap = await getDoc(doc(db, 'dances', danceId));
  if (!danceSnap.exists()) {
    console.error(`No dance found for ID "${danceId}".`);
    return;
  }

  // Expected fields on the dances/{danceId} doc, per Section 10's schema:
  // youtubeVideoId, skeletonUrl, songTitle, artist, loopSections, etc.
  currentDance = danceSnap.data();

  ytPlayer = new YT.Player('yt-player', {
    videoId: currentDance.youtubeVideoId,
    playerVars: {
      controls: 1,
      rel: 0,
      modestbranding: 1
    },
    events: {
      onReady: onPlayerReady,
      onStateChange: onPlayerStateChange
    }
  });
}

function onPlayerReady() {
  sizeOverlayToPlayer();
  loadSkeletonData(); // fetch the reference skeleton JSON, then start syncing
}

function onPlayerStateChange(event) {
  // Pause the sync loop when the video isn't playing so it isn't wastefully
  // redrawing the overlay every 100ms while paused.
  if (event.data === YT.PlayerState.PLAYING) {
    startSyncLoop();
  } else {
    stopSyncLoop();
  }
}

// Matches the overlay canvas's pixel size to the YouTube iframe underneath it
// so drawn joint coordinates line up with the video.
function sizeOverlayToPlayer() {
  const iframe = document.querySelector('#yt-player iframe');
  if (!iframe || !referenceCanvas) return;
  referenceCanvas.width = iframe.clientWidth;
  referenceCanvas.height = iframe.clientHeight;
}

// ============================================================
// 2. REFERENCE SKELETON DATA + SYNC LOOP
// ============================================================

async function loadSkeletonData() {
  // skeletonUrl is the Storage download URL saved on the dance doc by
  // admin.html when the dance was added (Section 24).
  const skeletonUrl = currentDance?.skeletonUrl;

  if (!skeletonUrl) {
    console.warn('This dance has no skeletonUrl — sync loop will run with no data.');
    return;
  }

  const res = await fetch(skeletonUrl);
  skeletonData = await res.json(); // expected shape: array of { t, joints: [...] }
}

// Polls YouTube's current time every 100ms, finds the closest matching
// keyframe in the skeleton data, and redraws the overlay at that keyframe.
function startSyncLoop() {
  if (syncIntervalId) return; // already running
  syncIntervalId = setInterval(() => {
    if (!ytPlayer || typeof ytPlayer.getCurrentTime !== 'function') return;
    const currentTime = ytPlayer.getCurrentTime();
    const keyframe = findClosestKeyframe(currentTime);
    drawSkeleton(referenceCanvas, keyframe, { opacity: 1 });
  }, 100);
}

function stopSyncLoop() {
  clearInterval(syncIntervalId);
  syncIntervalId = null;
}

function findClosestKeyframe(currentTime) {
  if (!skeletonData || skeletonData.length === 0) return null;
  // Simple nearest-timestamp lookup — fine at 100ms polling resolution.
  return skeletonData.reduce((closest, frame) =>
    Math.abs(frame.t - currentTime) < Math.abs(closest.t - currentTime) ? frame : closest
  );
}

// ============================================================
// 3. MEDIAPIPE POSE LANDMARKER (live webcam detection)
// ============================================================

async function initPoseLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
  );

  poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
      delegate: "GPU"
    },
    runningMode: "VIDEO",
    numPoses: 1
  });
}

// Webcam access requires a user gesture — wired to the "Start Camera" button
// rather than requested automatically on page load.
async function startCamera() {
  try {
    webcamStream = await navigator.mediaDevices.getUserMedia({ video: true });
    webcamVideoEl.srcObject = webcamStream;
    await webcamVideoEl.play();

    liveCanvas.width = webcamVideoEl.clientWidth;
    liveCanvas.height = webcamVideoEl.clientHeight;

    webcamLoopActive = true;
    requestAnimationFrame(detectWebcamLoop);

    startCameraBtn.disabled = true;
    stopCameraBtn.disabled = false;
  } catch (err) {
    // TODO: swap for the friendly retry-UI error message from the spec
    // rather than a console log — camera permission denial needs to be
    // visible to the user, not silent.
    console.error('Camera permission denied or unavailable:', err);
  }
}

// Stops the detection loop and releases the camera hardware — the track
// has to be stopped explicitly or the browser's camera indicator stays on.
function stopCamera() {
  webcamLoopActive = false;

  if (webcamStream) {
    webcamStream.getTracks().forEach((track) => track.stop());
    webcamStream = null;
  }
  webcamVideoEl.srcObject = null;

  const ctx = liveCanvas.getContext('2d');
  ctx.clearRect(0, 0, liveCanvas.width, liveCanvas.height);

  startCameraBtn.disabled = false;
  stopCameraBtn.disabled = true;
}

function detectWebcamLoop() {
  if (!webcamLoopActive || !poseLandmarker) return;

  const result = poseLandmarker.detectForVideo(webcamVideoEl, performance.now());
  const landmarks = result.landmarks?.[0] || null;
  drawSkeleton(liveCanvas, landmarks, { opacity: 1 });

  requestAnimationFrame(detectWebcamLoop);
}

// ============================================================
// 4. SHARED OVERLAY DRAWING
// ============================================================
// Used for both the reference overlay (pre-recorded keyframes) and the
// live overlay (real-time MediaPipe results) — same drawing logic, just
// fed from different data sources, per the phantom-overlay note in the spec.

const POSE_CONNECTIONS = PoseLandmarker.POSE_CONNECTIONS;

function drawSkeleton(canvas, landmarks, { opacity = 1 } = {}) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!landmarks) return;

  ctx.globalAlpha = opacity;
  ctx.strokeStyle = '#3fae8a'; // Mint, per Section 26 — reserved for positive/feedback state
  ctx.lineWidth = 3;

  // Bones
  POSE_CONNECTIONS.forEach(({ start, end }) => {
    const a = landmarks[start];
    const b = landmarks[end];
    if (!a || !b) return;
    ctx.beginPath();
    ctx.moveTo(a.x * canvas.width, a.y * canvas.height);
    ctx.lineTo(b.x * canvas.width, b.y * canvas.height);
    ctx.stroke();
  });

  // Joints
  ctx.fillStyle = '#e24e64'; // Coral Active, per Section 26
  landmarks.forEach((point) => {
    ctx.beginPath();
    ctx.arc(point.x * canvas.width, point.y * canvas.height, 4, 0, 2 * Math.PI);
    ctx.fill();
  });

  ctx.globalAlpha = 1;
}

// ============================================================
// 5. STARTUP
// ============================================================

window.addEventListener('DOMContentLoaded', () => {
  initPoseLandmarker(); // MediaPipe: async, self-initializing
  // YouTube: no manual call needed — window.onYouTubeIframeAPIReady fires on its own

  if (startCameraBtn) {
    startCameraBtn.addEventListener('click', startCamera);
  }
  if (stopCameraBtn) {
    stopCameraBtn.addEventListener('click', stopCamera);
  }

  window.addEventListener('resize', sizeOverlayToPlayer);
});
