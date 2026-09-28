/**
 * The launcher's page wiring: launcher.js decides, this only touches the
 * page. Text is only ever set with textContent, the frame's address is only
 * ever a path launcher.js built from its own constants, and the one
 * navigation is location.replace to the address launcher.js checked. Loaded
 * as a module from index.html, because the page's policy allows scripts from
 * this origin and nothing inline.
 */
import { MESSAGES, MESSAGE_TYPE, SITE_ORIGINS, runLauncher } from './launcher.js';

const status = document.getElementById('status');
const slot = document.getElementById('frame-slot');
let frame = null;

const ui = {
  say(text) {
    status.textContent = text;
  },
  frame(path) {
    if (frame) {
      frame.remove();
      frame = null;
    }
    if (path === null) return;
    frame = document.createElement('iframe');
    frame.title = MESSAGES['frame-title'];
    frame.src = path;
    slot.append(frame);
  },
};

/** The site, whichever of its two names holds this pane. Nothing is posted to a page that is not framing this one. */
function post(state) {
  if (window.parent === window) return;
  for (const origin of SITE_ORIGINS) {
    window.parent.postMessage({ type: MESSAGE_TYPE, state }, origin);
  }
}

runLauncher({
  search: window.location.search,
  fetch: (path, init) => window.fetch(path, init),
  ui,
  post,
  navigate: (url) => window.location.replace(url),
  sleep: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
  now: () => Date.now(),
});
