# Garden of Wellbeing (Suan Suk)

A gentle, camera-based movement game for seniors. Your webcam follows your body with
[MediaPipe Pose](https://developers.google.com/mediapipe), and a 3D farmer in a
[Three.js](https://threejs.org/) garden copies your moves while you play.

No install, no account, no build step. It's plain HTML, CSS and JavaScript, and it can be
installed to the home screen as a Progressive Web App.

## Activities

| Activity | Exercise | How to play |
|---|---|---|
| Sweet Potato Pull | Sit-to-Stand | Sit side-on to the camera, then stand up tall |
| High Fruit Picking | Arm Raises | Face the camera and raise both arms high |
| Fruit Sorting | Torso Twists | Apples go left, oranges go right |

It also includes a calibration step, a body profile, a choice of farmer avatars,
a coach panel with live joint angles, and a lighter "fast" mode for phones.

## Run it locally

Browsers only allow camera access on `https://` or `http://localhost`, so serve the folder
instead of double-clicking `index.html`:

```bash
# Python 3
python -m http.server 8000
# or Node.js
npx serve .
```

Then open <http://localhost:8000> and allow camera access.

## Publish with GitHub Pages

1. Push this repository to GitHub.
2. Go to **Settings → Pages**, set **Source** to *Deploy from a branch*, and pick `main` / `(root)`.
3. After a minute, the game is live at `https://<your-username>.github.io/<repo-name>/`.

GitHub Pages serves over HTTPS, so the camera works on phones and tablets too.

## Project structure

```
index.html            page layout, styles and screens
game.js               config, shared state, scoring, HUD, audio, UI (creates the global GW object)
calibration.js        calibration step and body profile
mediapipe.js          camera + pose tracking
three-scene.js        3D garden, farmer avatars and effects
manifest.webmanifest  PWA settings
icons/                app icons
```

## Optional: Y Bot avatar

The "Y Bot" avatar needs `y_bot_from_mixamo.glb` next to `index.html`. The file is not in
this repository (check Mixamo's terms before sharing it). You can download it yourself from
[Mixamo](https://www.mixamo.com/). The built-in farmer avatars work without it.

## Libraries (loaded from CDN)

- MediaPipe Pose `0.5.1675469404` and Camera Utils `0.3.1675466862`
- Three.js `r128` with GLTFLoader
- Nunito font from Google Fonts

An internet connection is needed the first time the game loads.

## Privacy

All pose tracking runs in the browser. Camera video is never uploaded anywhere.
