/**
 * docker education data (#778).
 *
 * DOCKER RUNS NO CERTIFICATION EXAM OF ITS OWN. Checked on docker.com on
 * 2026-09-29: https://www.docker.com/trainings/ ("Skill up with Docker",
 * og:updated_time 2026-07-23) is Docker's own list of what to learn, and it
 * offers self-guided modules in its documentation, a YouTube series, and one
 * credential that someone else issues. `DOCKER_RUNS_OWN_EXAM` says so as
 * data, and `CREDENTIALS_NOTE` says it to the visitor on /docker/education.
 * The two rows under `certifications` are therefore credentials OTHER
 * organizations issue, and each row names its `issuer`:
 *
 *   Docker Foundations Professional Certificate — LinkedIn Learning.
 *     docker.com/trainings: "Earn a Docker Foundations Professional
 *     Certificate from LinkedIn Learning, after completing 3 courses and
 *     passing an exam. You will need a LinkedIn Learning subscription."
 *     https://www.linkedin.com/learning/paths/docker-foundations-professional-certificate
 *     (read 2026-09-29): Learning Docker 2h 6m, Docker: Your First Project
 *     59m, Learning Docker Compose 36m, "4 hours of content", "pass the final
 *     exam, and earn your certificate". The page names no co-issuer.
 *   Docker Certified Associate (DCA) — Mirantis.
 *     https://training.mirantis.com/certification/dca-certification-exam/
 *     (read 2026-09-29): "13 multiple choice and 42 discrete option multiple
 *     choice (DOMC) questions in 90 minutes", "Available globally in
 *     English", "USD $199 or Euro €200", "valid for 2 years". docker.com does
 *     not list it. Listed because it is the exam a visitor searching for a
 *     Docker certification will find, and the card says who runs it.
 *
 * THE LEARNING PATHS are the six modules docker.com/trainings links, each
 * read at its own page on 2026-09-29, plus the LinkedIn path above. Titles,
 * module lists, skill levels and times are the pages' own; nothing is
 * estimated. Where a page states no level or time, the row has none.
 * Two things the training page itself gets wrong, and this file does not
 * copy: its "Getting Started" link now redirects to
 * /get-started/tutorials/run-an-app/ (used directly below), and its Docker
 * Compose and Docker Build Cloud cards carry each other's one-line blurbs
 * ("up to 39x faster" is Build Cloud's).
 *
 * `DATA_AS_OF` is the day all of the above was read. When a row changes,
 * re-read the page it came from and move the date, as the other catalogues do.
 */
export const DATA_AS_OF = '2026-09-29';

export const DATA_SOURCE = {
  label: 'Docker Training',
  url: 'https://www.docker.com/trainings/',
};

/** Docker publishes no certification exam of its own (see the header). */
export const DOCKER_RUNS_OWN_EXAM = false;

/** What /docker/education tells the visitor before the cards. */
export const CREDENTIALS_NOTE =
  'Docker does not run a certification exam of its own. The one credential docker.com points to is the Docker Foundations Professional Certificate from LinkedIn Learning. The Docker Certified Associate exam still exists, but Mirantis runs it, not Docker.';

export const levelMeta = {
  Foundational: {
    badge: 'bg-sky-500/20 border-sky-500/40 text-sky-300',
    accent: 'border-l-sky-500',
    dot: 'bg-sky-500',
    label: 'Foundational',
  },
  Associate: {
    badge: 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300',
    accent: 'border-l-emerald-500',
    dot: 'bg-emerald-500',
    label: 'Associate',
  },
};

export const filterLevels = ['All', 'Foundational', 'Associate'];

export const certifications = [
  {
    id: 'docker-foundations',
    slug: 'docker-foundations',
    code: 'Docker Foundations',
    title: 'Docker Foundations Professional Certificate',
    issuer: 'LinkedIn Learning',
    level: 'Foundational',
    status: 'active',
    description:
      'The one credential docker.com points to. Complete three courses, Learning Docker, Docker: Your First Project and Learning Docker Compose, then pass a final exam. It needs a LinkedIn Learning subscription.',
    topics: ['Learning Docker', 'A first project', 'Docker Compose'],
    hours: 4,
    featured: true,
    learnUrl: 'https://www.linkedin.com/learning/paths/docker-foundations-professional-certificate',
  },
  {
    id: 'dca',
    slug: 'dca',
    code: 'DCA',
    title: 'Docker Certified Associate',
    issuer: 'Mirantis',
    level: 'Associate',
    status: 'active',
    description:
      'Mirantis runs this exam, not Docker, and docker.com does not list it. It has 13 multiple-choice and 42 discrete-option multiple-choice questions in 90 minutes, in English, for USD 199 or EUR 200, and the certification is valid for two years.',
    featured: false,
    learnUrl: 'https://training.mirantis.com/certification/dca-certification-exam/',
  },
];

export const learningPaths = [
  {
    id: 'get-started',
    certCode: 'Docker Docs',
    title: 'Build and share a containerized application',
    duration: '15 minutes',
    description:
      'Docker’s own first tutorial: run a container, start a multi-container application, package it as an image, and share the image through Docker Hub. You need Docker Desktop, Git and a Docker account.',
    modules: [
      { title: 'Run a container' },
      { title: 'Run an application stack' },
      { title: 'Build an image' },
      { title: 'Share the image' },
    ],
    certUrl: 'https://docs.docker.com/get-started/tutorials/run-an-app/',
    linkLabel: 'Open the tutorial',
  },
  {
    id: 'building-images',
    certCode: 'Docker Docs',
    title: 'Building images',
    level: 'Beginner',
    duration: '25 minutes',
    description:
      'How images are built and how to keep them small and quick to rebuild, ending with multi-stage builds.',
    modules: [
      { title: 'Understanding the image layers' },
      { title: 'Writing a Dockerfile' },
      { title: 'Build, tag, and publish an image' },
      { title: 'Using the build cache' },
      { title: 'Multi-stage builds' },
    ],
    certUrl: 'https://docs.docker.com/get-started/docker-concepts/building-images/',
    linkLabel: 'Open the series',
  },
  {
    id: 'docker-compose',
    certCode: 'Docker Docs',
    title: 'Defining and running multi-container applications with Docker Compose',
    description:
      'Describe every container an application needs in one YAML file and run them together, with a demo and answers to the common questions.',
    modules: [
      { title: 'What Docker Compose is and what it does' },
      { title: 'How to define services' },
      { title: 'Use cases for Docker Compose' },
      { title: 'How things would be different without Docker Compose' },
    ],
    certUrl: 'https://docs.docker.com/guides/docker-compose/',
    linkLabel: 'Open the guide',
  },
  {
    id: 'docker-scout',
    certCode: 'Docker Docs',
    title: 'Securing your software supply chain with Docker Scout',
    description:
      'Find and fix vulnerabilities in your images: software bills of materials, attestations and remediation.',
    modules: [
      { title: 'Define Secure Software Supply Chain (SSSC)' },
      { title: 'Review SBOMs and how to use them' },
      { title: 'Detect and monitor vulnerabilities' },
    ],
    certUrl: 'https://docs.docker.com/guides/docker-scout/',
    linkLabel: 'Open the guide',
  },
  {
    id: 'docker-build-cloud',
    certCode: 'Docker Docs',
    title: 'Docker Build Cloud: Reclaim your time with fast, multi-architecture builds',
    description:
      'Build images on cloud builders with a cache your team shares, including images for more than one CPU architecture.',
    modules: [
      { title: 'Building container images faster locally and in CI' },
      { title: 'Accelerating builds for multi-platform images' },
      { title: 'Reusing pre-built images to expedite workflows' },
    ],
    certUrl: 'https://docs.docker.com/guides/docker-build-cloud/',
    linkLabel: 'Open the guide',
  },
  {
    id: 'admin-set-up',
    certCode: 'Docker Docs',
    title: 'Set up your company for success with Docker',
    description:
      'For administrators rolling Docker out across a company: the Docker organization, a standard Docker Desktop setup, and security settings.',
    modules: [
      { title: 'Signing in to your company’s Docker organization' },
      { title: 'Standardizing Docker Desktop versions and settings' },
      { title: 'Docker’s security configurations for company requirements' },
    ],
    certUrl: 'https://docs.docker.com/guides/admin-set-up/',
    linkLabel: 'Open the guide',
  },
  {
    id: 'docker-foundations-path',
    certCode: 'Docker Foundations',
    title: 'Docker Foundations Professional Certificate path',
    duration: 'about 4 hours',
    description:
      'The three LinkedIn Learning courses behind the certificate, followed by its final exam. Needs a LinkedIn Learning subscription.',
    modules: [
      { title: 'Learning Docker (2h 6m)' },
      { title: 'Docker: Your First Project (59m)' },
      { title: 'Learning Docker Compose (36m)' },
    ],
    certUrl: 'https://www.linkedin.com/learning/paths/docker-foundations-professional-certificate',
    linkLabel: 'View the path',
  },
];

export const resources = [
  {
    id: 'docker-training',
    title: 'Docker Training',
    description:
      'Docker’s own list of what to learn: the self-guided modules above, its video series and the LinkedIn Learning certificate.',
    type: 'Learning Platform',
    icon: 'school',
    url: 'https://www.docker.com/trainings/',
  },
  {
    id: 'docker-docs',
    title: 'Docker documentation',
    description:
      'Manuals, guides and command references for Docker Desktop, Docker Engine, Compose, Build and the rest.',
    type: 'Documentation',
    icon: 'description',
    url: 'https://docs.docker.com/',
  },
  {
    id: 'docker-guides',
    title: 'Docker guides',
    description:
      'Step-by-step guides, including language-specific ones for containerizing an application of your own.',
    type: 'Guides',
    icon: 'map',
    url: 'https://docs.docker.com/guides/',
  },
  {
    id: 'docker-concepts-youtube',
    title: 'Docker Concepts on YouTube',
    description:
      'Docker’s own video series on the essential concepts, the foundations of building with containers.',
    type: 'Video',
    icon: 'smart_display',
    url: 'https://www.youtube.com/playlist?list=PLkA60AVN3hh_nsDu5HtEqZ-xfjF-0-PfX',
  },
];
