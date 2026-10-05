/**
 * Google Cloud certification catalogue for /gcp/education (#461).
 *
 * Verified 2026-09-09 against https://cloud.google.com/learn/certification
 * and each credential's own page under that path; the page had nine and still
 * called the Workspace credential "Professional", which Google retired in
 * favour of the Associate Google Workspace Administrator (the Professional
 * URL now returns 404).
 *
 * RE-VERIFIED 2026-09-09 (#469 item 1) against the same index, which now
 * lists FIFTEEN — two Foundational, three Associate and ten Professional.
 * Thirteen were carried. The two that were not:
 *
 *   Professional Security Operations Engineer — added `active`. Two hours,
 *     $200, English and Japanese, 50-60 questions.
 *     https://cloud.google.com/learn/certification/security-operations-engineer
 *   Professional Agentic Architect — added `beta`. Google's index labels it
 *     "Agentic Architect (Beta)" and the certification page says the beta
 *     "is open until September 30", which is `betaEndDate` below. Three
 *     hours, $120 at the beta's 40% discount off a $200 retail price,
 *     English, ~80 questions, and a ONE-year validity rather than the two
 *     years a Professional certification normally carries.
 *     https://cloud.google.com/learn/certification/agentic-architect
 *
 * That `betaEndDate` is deliberate and it is an alarm: `findStaleStatuses`
 * fails the suite on 2026-10-01 for a `beta` row whose beta window has shut,
 * which is exactly when someone must go and read whether Google took it to
 * GA, extended the window, or withdrew it. No GA date is published yet, so
 * none is invented here.
 *
 * PAA RE-READ 2026-09-11 (#494), and nothing had moved: the page still says
 * "open until September 30", still three hours, ~80 questions, $120 against a
 * $200 retail price, English, one-year validity, and still publishes no GA
 * date. So the row below is right as it stands and there was nothing to
 * change. `DATA_AS_OF` is deliberately NOT bumped — one row was re-read, not
 * all fifteen credentials, and that field is a claim about the whole file.
 *
 * What #494 could not do, and no day before 2026-10-01 can: say what the
 * credential becomes. The post-beta state does not exist yet. The alarm is
 * what carries that obligation — on 2026-10-01 the suite fails naming PAA and
 * pointing at `DATA_SOURCE`, which is the same instruction an open ticket
 * would have carried, delivered on the day it becomes actionable instead of
 * sitting on a board for three weeks.
 *
 * Google does not publish exam codes; the `code` values here are the
 * community short forms this page has always used.
 *
 * RE-VERIFIED 2026-09-10 (#469) against the same index plus the two pages
 * whose numbers this file quotes. Nothing changed — the index still lists
 * FIFTEEN in the same three tiers (Foundational: Cloud Digital Leader,
 * Generative AI Leader; Associate: Cloud Engineer, Google Workspace
 * Administrator, Data Practitioner; Professional: the ten below), and every
 * row here is one of them. The two dated or priced rows were re-read at the
 * source rather than assumed:
 *
 *   Professional Agentic Architect — the banner still reads "The Professional
 *     Agentic Architect beta certification is open until September 30", and
 *     the beta exam details still say 3 hours, $120 (40% off a $200 retail
 *     price), ~80 multiple choice questions. `betaEndDate` is unchanged.
 *     https://cloud.google.com/learn/certification/agentic-architect
 *   Professional Security Operations Engineer — still 2 hours, $200, English
 *     and Japanese, 50-60 questions.
 *     https://cloud.google.com/learn/certification/security-operations-engineer
 *
 * So the `betaEndDate` alarm described above still stands, unmoved and now
 * close: it fires on 2026-10-01, and that row is the one the next pass is
 * really for. Google has still published no GA date, so there is still none
 * here.
 *
 * PAA RE-READ 2026-10-01 (#770), the day after its beta window closed, with a
 * live fetch of the certification page and of Google's index:
 *     https://cloud.google.com/learn/certification/agentic-architect
 *     https://cloud.google.com/learn/certification
 * Neither has moved since 2026-09-29. The banner on both still reads "The
 * Professional Agentic Architect beta certification is open until September
 * 30!", the index still lists "Agentic Architect (Beta)", and the page still
 * says "Beta participants will be notified of their results 4-6 weeks after
 * both the exam window and lab window are closed. You can pass the beta or GA
 * certification". The beta exam details are unchanged (3 hours, $120 against
 * a $200 retail price, English, ~80 questions, 1-year validity). Google
 * published no GA date, no new beta window, and no withdrawal.
 *
 * So the row is now `upcoming` with no date: the beta closed on 2026-09-30 and
 * there is nothing a reader can book until Google dates the GA exam. That
 * stored status says by itself what `betaClosesBeforeGa` used to derive from a
 * stored `beta`, so the flag and `betaEndDate` are gone from the row — the
 * flag is read only for a `beta` row, and an `upcoming` row with no
 * `availableDate` makes no claim the alarm can catch going stale. The next
 * re-read is when Google publishes a GA date: set `availableDate` then, and
 * the alarm takes over again. `DATA_AS_OF` is deliberately NOT bumped — one
 * row was re-read, not all fifteen credentials.
 *
 *
 * FULL RE-READ 2026-10-05 (owner request: review every Learn portal for exams
 * newly in beta or expired). All fifteen credential pages and the index were
 * live-fetched; the index still lists fifteen in the same three tiers, still
 * labelled "Agentic Architect (Beta)" for PAA, and every H1 matched its row's
 * title. No retirement, rename or new credential. Two things moved:
 *
 *   Professional Agentic Architect — Google has dated the next step. Index
 *     and page banner: "Professional Agentic Architect beta registration is
 *     closed. GA registration opens November 2." Button: "GA registration
 *     opens Nov 2". The beta FAQ: "The exam GA will be available to the
 *     public in mid-November.", "a 2-hour session with official results
 *     provided in 7–10 business days", "$200 USD", and the beta's results
 *     "at the end of October" with the required labs due by December 31,
 *     2026. That is a REGISTRATION day, not an exam-available day — setting
 *     `availableDate: '2026-11-02'` would flip the row to `active` on a day
 *     nobody can sit the exam — so the row stays `upcoming` with no date and
 *     the description carries the two facts. Set `availableDate` when Google
 *     names the exam day (mid-November is not a date).
 *     https://cloud.google.com/learn/certification/agentic-architect
 *     https://support.google.com/cloud-certification/answer/18080541
 *   Professional Machine Learning Engineer — content, not status: "This exam
 *     was updated to reflect the transition from Vertex AI to Gemini
 *     Enterprise Agent Platform, updates to Google Cloud's data and analytics
 *     stack, and prioritizes Google Cloud native solutions." The row's
 *     description and topics named Vertex AI; they now name what the exam
 *     guide does. The index carries the same note for every exam ("Our exams
 *     are being updated to reflect product updates announced at Google Cloud
 *     Next '26"), so PAA's "Vertex AI Agents" topic follows too.
 *     https://cloud.google.com/learn/certification/machine-learning-engineer
 *
 * Google's beta-exams help page names no running beta. All fifteen rows were
 * re-read, so `DATA_AS_OF` moves for the first time since 2026-09-10.
 *
 * `status` and any dates are read through `@/lib/certStatus` at render time;
 * `src/data/education-catalogues.test.js` fails when a dated row is past.
 */
export const DATA_AS_OF = '2026-10-05';

export const DATA_SOURCE = {
  label: 'Google Cloud certifications',
  url: 'https://cloud.google.com/learn/certification',
};

export const certifications = [
  {
    id: 'cdl',
    slug: 'cdl',
    code: 'CDL',
    title: 'Cloud Digital Leader',
    level: 'Foundational',
    status: 'active',
    description:
      'Understand how Google Cloud products can support digital transformation and drive business value.',
    topics: ['Digital Transformation', 'Cloud Value', 'Products'],
    hours: 10,
    prepTime: '~4 weeks',
    featured: false,
    learnUrl: 'https://cloud.google.com/learn/certification/cloud-digital-leader',
  },
  {
    id: 'gail',
    slug: 'gail',
    code: 'GAIL',
    title: 'Generative AI Leader',
    level: 'Foundational',
    status: 'active',
    description:
      'Explain generative AI fundamentals, Google Cloud gen AI offerings, ways to improve model output, and business strategies for gen AI solutions.',
    topics: ['Gen AI Fundamentals', 'Gemini', 'Prompting', 'AI Strategy'],
    hours: 12,
    prepTime: '~4 weeks',
    featured: false,
    learnUrl: 'https://cloud.google.com/learn/certification/generative-ai-leader',
  },
  {
    id: 'ace',
    slug: 'ace',
    code: 'ACE',
    title: 'Associate Cloud Engineer',
    level: 'Associate',
    status: 'active',
    description:
      'Deploy applications, monitor operations, and manage enterprise cloud solutions on Google Cloud.',
    topics: ['Compute', 'Storage', 'Networking', 'IAM', 'Billing'],
    hours: 40,
    prepTime: '~3 months',
    featured: false,
    learnUrl: 'https://cloud.google.com/learn/certification/cloud-engineer',
  },
  {
    id: 'adp',
    slug: 'adp',
    code: 'ADP',
    title: 'Associate Data Practitioner',
    level: 'Associate',
    status: 'active',
    description:
      'Prepare and ingest data, analyze and present it, orchestrate pipelines, and manage data on Google Cloud.',
    topics: ['Data Ingestion', 'BigQuery', 'Pipelines', 'Data Management'],
    hours: 30,
    prepTime: '~2 months',
    featured: false,
    learnUrl: 'https://cloud.google.com/learn/certification/data-practitioner',
  },
  {
    id: 'agwa',
    slug: 'agwa',
    code: 'AGWA',
    title: 'Associate Google Workspace Administrator',
    level: 'Associate',
    status: 'active',
    description:
      'Manage users and objects, core Workspace services, security policies, endpoints, and day-to-day troubleshooting in a Google Workspace environment.',
    topics: ['Admin Console', 'Security', 'Endpoints', 'Compliance'],
    hours: 30,
    prepTime: '~2 months',
    featured: false,
    learnUrl:
      'https://cloud.google.com/learn/certification/associate-google-workspace-administrator',
  },
  {
    id: 'pca',
    slug: 'pca',
    code: 'PCA',
    title: 'Professional Cloud Architect',
    level: 'Professional',
    status: 'active',
    description:
      'Design, develop, and manage robust, secure, scalable, highly available, and dynamic solutions on Google Cloud.',
    topics: ['Architecture', 'GKE', 'Multi-Region', 'Disaster Recovery'],
    hours: 60,
    prepTime: '~6 months',
    featured: true,
    learnUrl: 'https://cloud.google.com/learn/certification/cloud-architect',
  },
  {
    id: 'pcd',
    slug: 'pcd',
    code: 'PCD',
    title: 'Professional Cloud Developer',
    level: 'Professional',
    status: 'active',
    description:
      'Build and deploy scalable, secure applications using Google Cloud services and developer tooling.',
    topics: ['App Engine', 'Cloud Run', 'GKE', 'APIs', 'DevOps'],
    hours: 55,
    prepTime: '~5 months',
    featured: false,
    learnUrl: 'https://cloud.google.com/learn/certification/cloud-developer',
  },
  {
    id: 'pde',
    slug: 'pde',
    code: 'PDE',
    title: 'Professional Data Engineer',
    level: 'Professional',
    status: 'active',
    description:
      'Design and build data processing systems and create machine learning models using Google Cloud.',
    topics: ['BigQuery', 'Dataflow', 'Pub/Sub', 'Bigtable', 'ML'],
    hours: 55,
    prepTime: '~5 months',
    featured: false,
    learnUrl: 'https://cloud.google.com/learn/certification/data-engineer',
  },
  {
    id: 'pcdbe',
    slug: 'pcdbe',
    code: 'PCDBE',
    title: 'Professional Cloud Database Engineer',
    level: 'Professional',
    status: 'active',
    description:
      'Design, migrate, deploy, and manage scalable, highly available database solutions spanning Cloud SQL, Spanner, AlloyDB and more.',
    topics: ['Cloud SQL', 'Spanner', 'AlloyDB', 'Migration', 'HA'],
    hours: 50,
    prepTime: '~5 months',
    featured: false,
    learnUrl: 'https://cloud.google.com/learn/certification/cloud-database-engineer',
  },
  {
    id: 'pcdoe',
    slug: 'pcdoe',
    code: 'PCDOE',
    title: 'Professional Cloud DevOps Engineer',
    level: 'Professional',
    status: 'active',
    description:
      'Bootstrap a Google Cloud organization, apply SRE practices, build CI/CD pipelines, implement observability, and optimize performance and cost.',
    topics: ['SRE', 'CI/CD', 'Observability', 'Cost'],
    hours: 50,
    prepTime: '~5 months',
    featured: false,
    learnUrl: 'https://cloud.google.com/learn/certification/cloud-devops-engineer',
  },
  {
    id: 'pcse',
    slug: 'pcse',
    code: 'PCSE',
    title: 'Professional Cloud Security Engineer',
    level: 'Professional',
    status: 'active',
    description:
      'Configure and manage security across Google Cloud services, including IAM, VPC, and compliance.',
    topics: ['IAM', 'VPC', 'Encryption', 'Compliance', 'BeyondCorp'],
    hours: 50,
    prepTime: '~5 months',
    featured: false,
    learnUrl: 'https://cloud.google.com/learn/certification/cloud-security-engineer',
  },
  {
    id: 'pcne',
    slug: 'pcne',
    code: 'PCNE',
    title: 'Professional Cloud Network Engineer',
    level: 'Professional',
    status: 'active',
    description: 'Implement and manage networking infrastructure in Google Cloud environments.',
    topics: ['VPC', 'Load Balancing', 'Cloud CDN', 'Interconnect'],
    hours: 45,
    prepTime: '~4 months',
    featured: false,
    learnUrl: 'https://cloud.google.com/learn/certification/cloud-network-engineer',
  },
  {
    id: 'pmle',
    slug: 'pmle',
    code: 'PMLE',
    title: 'Professional Machine Learning Engineer',
    level: 'Professional',
    status: 'active',
    description:
      'Design, build, and productionize ML and generative AI solutions on Google Cloud with Gemini Enterprise Agent Platform, MLOps and the data and analytics stack.',
    topics: [
      'Gemini Enterprise Agent Platform',
      'MLOps',
      'Pipelines',
      'Model Evaluation',
      'Data & Analytics',
    ],
    hours: 55,
    prepTime: '~5 months',
    featured: false,
    learnUrl: 'https://cloud.google.com/learn/certification/machine-learning-engineer',
  },
  {
    id: 'psoe',
    slug: 'psoe',
    code: 'PSOE',
    title: 'Professional Security Operations Engineer',
    level: 'Professional',
    status: 'active',
    description:
      'Run a security operations practice on Google Cloud — detection engineering, threat hunting, triage and response across Google Security Operations. Two hours, $200, 50-60 questions, English and Japanese.',
    topics: ['Google SecOps', 'Detection Engineering', 'Threat Hunting', 'Incident Response'],
    hours: 45,
    prepTime: '~4 months',
    featured: false,
    learnUrl: 'https://cloud.google.com/learn/certification/security-operations-engineer',
  },
  {
    id: 'paa',
    slug: 'paa',
    code: 'PAA',
    title: 'Professional Agentic Architect',
    level: 'Professional',
    status: 'upcoming',
    description:
      'Design, build, deploy and operate agentic systems on Google Cloud. The beta closed on September 30, 2026; registration for the GA exam opens November 2, 2026 and Google expects the exam itself in mid-November as a two-hour, $200 exam with hands-on labs to follow a pass. The beta was three hours, ~80 questions, $120 at the beta discount, English only, with a one-year validity rather than the usual two.',
    topics: [
      'Agentic Systems',
      'Gemini Enterprise Agent Platform',
      'Orchestration',
      'Evaluation',
      'Operations',
    ],
    hours: 50,
    prepTime: '~4 months',
    featured: false,
    learnUrl: 'https://cloud.google.com/learn/certification/agentic-architect',
  },
];
