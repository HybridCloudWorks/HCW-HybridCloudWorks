/**
 * The credit beside the intro on `/education/labs` (owner request
 * 2026-09-28): the browser labs are provided using Coder, and Coder's name
 * links to its site.
 *
 * WHAT IT SAYS, AND WHY EACH WORD IS TRUE.
 *   - "using Coder", never "sponsored by": no sponsorship is confirmed, and
 *     the credit says only what the site does.
 *   - "open-source": the host runs Coder's Community edition (ADR 0032,
 *     decision 4), whose source is github.com/coder/coder under AGPL-3.0
 *     (read 2026-09-28).
 *   - "self-hosted development environments": Coder runs on the lab host,
 *     not as a service; its own words for a workspace are "self-hosted
 *     environments for developers" (coder.com, read 2026-09-28).
 *   - "built from our lab template": every workspace is the `hcw-lab`
 *     template, lab-host/coder/templates/hcw-lab/main.tf.
 *   - https://coder.com/ is the site's own `rel="canonical"`, and
 *     www.coder.com answers 308 to it (read 2026-09-28).
 *
 * THE LOGO is Coder's wordmark, inline, so `currentColor` takes the theme's
 * text colour and CSS can reach the square. `src/assets/brands/coder/`
 * holds the file it mirrors; CoderCredit.test.jsx fails when the two
 * differ. The square is `.coder-cursor`, which `src/index.css` blinks like a
 * terminal cursor: a 1 s step blink, five times after the page loads and
 * again while the pointer or keyboard focus is on the credit, and never
 * under `prefers-reduced-motion: reduce`. Five and not forever because WCAG
 * 2.2.2 (Level A) asks for a pause control on anything that blinks for more
 * than five seconds beside other content, and a logo is not worth one.
 *
 * The wordmark is used at every width. Below the desktop layout the credit
 * stacks under the intro at full width, which is as wide as the desktop
 * column or wider, so the wordmark always fits; `coder-mark.svg` (the "C"
 * and the square) is kept beside it for a smaller credit and is not used.
 */
import React from 'react';

export const CODER_URL = 'https://coder.com/';

/** The wordmark's frame, exactly as `coder-wordmark.svg` has it. */
export const WORDMARK_VIEW_BOX = '97 177 292 46';

/**
 * Coder's wordmark, "CODER" and the square that ends it. The paths are the
 * file's, in the file's order; the last one is the square.
 * @param {object} props
 * @param {string} [props.className]
 */
export function CoderWordmark({ className = '' }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={WORDMARK_VIEW_BOX}
      width="292"
      height="46"
      role="img"
      aria-label="Coder"
      className={className}
      data-testid="coder-wordmark"
    >
      <path
        fill="currentColor"
        d="M98.207 199.901C98.207 186.523 109.572 178 125.198 178C140.824 178 149.585 185.399 149.881 196.29L136.385 196.704C136.03 190.667 130.673 186.701 125.198 186.819C117.681 186.967 112.117 191.969 112.117 199.901C112.117 207.832 117.681 212.745 125.198 212.745C130.673 212.745 135.911 208.957 136.503 202.919L149.999 203.215C149.644 214.284 140.351 221.801 125.198 221.801C110.045 221.801 98.207 213.218 98.207 199.901Z"
      />
      <path
        fill="currentColor"
        d="M274.892 187.767H296.2V179.184H261.396V220.617H296.615V211.739H274.892V203.57H293.537V195.698H274.892V187.767Z"
      />
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M154.763 199.901C154.763 186.701 165.447 178 180.807 178C196.167 178 206.851 186.642 206.851 199.901C206.851 213.159 196.167 221.801 180.807 221.801C165.447 221.801 154.763 213.1 154.763 199.901ZM168.673 199.901C168.673 207.595 173.675 212.863 180.807 212.863C187.999 212.863 192.941 207.714 192.941 199.901C192.941 192.087 187.94 186.701 180.807 186.701C173.675 186.701 168.673 192.206 168.673 199.901Z"
      />
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M211.616 220.617V179.184H228.781C245.414 179.184 256.601 186.938 256.601 199.901C256.601 212.863 245.414 220.617 228.781 220.617H211.616ZM225.23 212.331H228.189C236.95 212.331 242.809 207.832 242.809 199.901C242.809 191.969 236.95 187.411 228.189 187.411H225.23V212.331Z"
      />
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M330.619 201.38C338.817 201.913 342.694 206.145 344.292 212.627L345.949 220.617H330.382L329.08 213.219C327.955 208.424 324.108 206.708 319.787 206.708H316.176V220.617H302.562V179.184H324.167C336.597 179.184 344.173 183.742 344.173 191.14C344.173 197.237 339.024 201.025 330.619 201.025V201.38ZM316.176 199.427H322.983C327.659 199.427 330.56 197.059 330.56 193.271C330.56 189.483 327.659 187.175 322.983 187.175H316.176V199.427Z"
      />
      <path
        className="coder-cursor"
        fill="currentColor"
        d="M351.928 179.184H387.442V220.617H351.928V179.184Z"
      />
    </svg>
  );
}

/**
 * THE ONE PLACE THE CREDIT'S MEDIA IS DECIDED. Today it is the wordmark,
 * with its square blinking. If the owner supplies a short looping mp4, it
 * goes under `public/` and this body becomes a video with the wordmark as
 * its fallback, and nothing else in the credit changes:
 *
 *   <video src="/media/coder-credit.mp4" autoPlay muted loop playsInline
 *     aria-label="Coder" className="h-7 w-auto">
 *     <CoderWordmark className="h-7 w-auto text-slate-950 dark:text-white" />
 *   </video>
 *
 * A looping video owes the same two things the blink does: it stops under
 * `prefers-reduced-motion: reduce`, and it loops for no more than five
 * seconds unless it has a pause control (WCAG 2.2.2).
 */
export function CoderCreditMedia() {
  return <CoderWordmark className="h-7 w-auto shrink-0 text-slate-950 dark:text-white" />;
}

/**
 * The credit block: the logo and two sentences, one of them naming Coder
 * with a link to its site in a new tab. The page places it: beside the
 * intro from `xl`, under it otherwise. Inside, the logo sits above the
 * sentences on a phone and in the desktop column, and beside them on a
 * tablet, where the block is a full-width row. `items-start` keeps a
 * column from stretching the logo, which would centre it in its box.
 */
export default function CoderCredit() {
  return (
    <aside
      aria-label="How we provide these labs"
      className="coder-credit glass rounded-xl p-5 flex flex-col items-start gap-3 md:flex-row md:items-center md:gap-6 xl:flex-col xl:items-start xl:gap-3"
      data-testid="coder-credit"
    >
      <CoderCreditMedia />
      <p className="text-sm text-slate-700 dark:text-slate-300">
        We provide these browser labs using{' '}
        <a
          href={CODER_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Coder (opens in a new tab)"
          className="font-semibold text-slate-950 dark:text-white underline underline-offset-4 hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          data-testid="coder-credit-link"
        >
          Coder
        </a>
        , the open-source platform for self-hosted development environments. Every lab workspace is
        a Coder workspace built from our lab template.
      </p>
    </aside>
  );
}
