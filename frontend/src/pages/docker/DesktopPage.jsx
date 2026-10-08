/**
 * `/docker/desktop` (#773): the Docker hub's second focus area, installing
 * Docker Desktop on Windows and macOS and using it day to day, ending at the
 * labs' own "Run it locally" line.
 *
 * LIVE-CHECK. Docker Desktop ships every week or so and its terms can change,
 * so the release, the subscription terms and the requirements below carry the
 * date they were read (CHECKED_ON). On 2026-10-02 they were read from:
 *   https://docs.docker.com/desktop/release-notes/        — 4.93.0, 2026-09-28,
 *                                                           Docker Engine v29.8.1
 *   https://docs.docker.com/subscription-billing/desktop-license/ — free for small
 *                                                           businesses (fewer than 250
 *                                                           employees AND less than
 *                                                           $10 million in annual revenue),
 *                                                           personal use, education and
 *                                                           non-commercial open source; a
 *                                                           paid subscription otherwise and
 *                                                           for government entities; Pro,
 *                                                           Team and Business include it;
 *                                                           Docker Engine's terms unchanged
 *   https://docs.docker.com/desktop/setup/install/windows-install/ — requirements, per-user
 *                                                           install, `wsl --version`
 *   https://docs.docker.com/desktop/setup/install/mac-install/ — current and two previous
 *                                                           macOS releases, 4 GB, the
 *                                                           hdiutil install
 *   https://docs.docker.com/desktop/features/wsl/         — the WSL 2 engine setting, the
 *                                                           docker-desktop distribution
 *   https://docs.docker.com/desktop/settings-and-maintenance/settings/ — Resources: limits
 *                                                           on Mac and Hyper-V, .wslconfig
 *                                                           in WSL 2 mode, Resource Saver,
 *                                                           Rosetta
 *   https://docs.docker.com/desktop/use-desktop/ (and /container, /images, /volumes,
 *                                                           /resource-saver)
 *   https://learn.microsoft.com/windows/wsl/wsl-config    — `[wsl2]` memory, processors,
 *                                                           swap, and `wsl --shutdown`
 * Re-read them, and move CHECKED_ON, before changing any of those facts.
 *
 * The run command is not written here: it is RUN_LOCALLY_COMMANDS from the lab
 * catalogue, the same two lines every lab card prints, so the two can never
 * disagree.
 */
import React from 'react';
import { LAB_IMAGE, RUN_LOCALLY_COMMANDS } from '@/data/labs/catalogue';
import { routes, staticRoutes } from '@/lib/routeFactory';
import DockerGuide, { Code, Commands, GuideSection, PROSE } from './DockerGuide';

export const PAGE_TITLE = 'The Docker Desktop app';

/** The page's path, which the landing page and the tools page link to. */
export const DESKTOP_PATH = routes.desktop('docker');

const CANONICAL = `https://hybridcloudworks.com${DESKTOP_PATH}`;

/** When the release, the terms and the requirements were last read from Docker's documentation. */
export const CHECKED_ON = Object.freeze({ iso: '2026-10-02', label: '2 October 2026' });

/** The newest Docker Desktop release on CHECKED_ON, and what it bundles. */
export const CURRENT_RELEASE = Object.freeze({
  version: '4.93.0',
  date: Object.freeze({ iso: '2026-09-28', label: '28 September 2026' }),
  engine: '29.8.1',
});

export const DOCS = Object.freeze({
  releaseNotes: 'https://docs.docker.com/desktop/release-notes/',
  licence: 'https://docs.docker.com/subscription-billing/desktop-license/',
  windowsInstall: 'https://docs.docker.com/desktop/setup/install/windows-install/',
  macInstall: 'https://docs.docker.com/desktop/setup/install/mac-install/',
  wsl: 'https://docs.docker.com/desktop/features/wsl/',
  settings: 'https://docs.docker.com/desktop/settings-and-maintenance/settings/',
  wslConfig: 'https://learn.microsoft.com/windows/wsl/wsl-config',
});

/** Docker's download links, exactly as its install pages give them. */
export const DOWNLOADS = Object.freeze({
  windows: 'https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe',
  macAppleSilicon: 'https://desktop.docker.com/mac/main/arm64/Docker.dmg',
  macIntel: 'https://desktop.docker.com/mac/main/amd64/Docker.dmg',
});

/** The `.wslconfig` example: Microsoft's own sample values for memory and processors. */
export const WSLCONFIG_EXAMPLE = '[wsl2]\nmemory=4GB\nprocessors=2';

const both = (command) =>
  Object.freeze([
    Object.freeze({ shell: 'PowerShell', command }),
    Object.freeze({ shell: 'bash', command }),
  ]);

/** Every command on the page except the lab line, by section. */
export const COMMANDS = Object.freeze({
  wslVersion: both('wsl --version'),
  wslUpdate: Object.freeze([
    Object.freeze({ shell: 'PowerShell (as administrator)', command: 'wsl --update' }),
  ]),
  windowsInstall: Object.freeze([
    Object.freeze({
      shell: 'PowerShell',
      command: `Invoke-WebRequest -Uri '${DOWNLOADS.windows}' -OutFile "$HOME\\Downloads\\Docker Desktop Installer.exe"`,
    }),
    Object.freeze({
      shell: 'PowerShell',
      command: `Start-Process "$HOME\\Downloads\\Docker Desktop Installer.exe" -Wait -ArgumentList 'install','--user'`,
    }),
    Object.freeze({
      shell: 'bash (Git Bash)',
      command: `curl -fLo "$HOME/Downloads/Docker Desktop Installer.exe" '${DOWNLOADS.windows}'`,
    }),
    Object.freeze({
      shell: 'bash (Git Bash)',
      command: '"$HOME/Downloads/Docker Desktop Installer.exe" install --user',
    }),
  ]),
  macDownload: Object.freeze([
    Object.freeze({
      shell: 'bash (Apple silicon Mac)',
      command: `curl -fLo Docker.dmg ${DOWNLOADS.macAppleSilicon}`,
    }),
    Object.freeze({
      shell: 'bash (Intel Mac)',
      command: `curl -fLo Docker.dmg ${DOWNLOADS.macIntel}`,
    }),
  ]),
  macInstall: Object.freeze([
    Object.freeze({ shell: 'bash', command: 'sudo hdiutil attach Docker.dmg' }),
    Object.freeze({
      shell: 'bash',
      command: 'sudo /Volumes/Docker/Docker.app/Contents/MacOS/install',
    }),
    Object.freeze({ shell: 'bash', command: 'sudo hdiutil detach /Volumes/Docker' }),
  ]),
  rosetta: Object.freeze([
    Object.freeze({
      shell: 'bash (Apple silicon Mac)',
      command: 'softwareupdate --install-rosetta',
    }),
  ]),
  version: both('docker version'),
  inventory: both('docker ps -a; docker image ls; docker volume ls'),
  diskUsage: both('docker system df'),
  editWslConfig: Object.freeze([
    Object.freeze({ shell: 'PowerShell', command: 'notepad "$HOME\\.wslconfig"' }),
    Object.freeze({ shell: 'bash (Git Bash)', command: 'notepad "$USERPROFILE/.wslconfig"' }),
  ]),
  wslShutdown: both('wsl --shutdown'),
  pull: both(`docker pull ${LAB_IMAGE}`),
});

const DESCRIPTION =
  'Installing Docker Desktop on Windows and macOS and using it day to day: the dashboard, images, containers and volumes, the WSL 2 backend and resource limits, running this site’s lab image, and how Desktop relates to Docker Engine on a Linux server.';

function DocLink({ href, children }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-semibold underline underline-offset-4"
    >
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

export default function DockerDesktopPage() {
  return (
    <DockerGuide
      pageId="docker-desktop"
      eyebrow="Docker · Desktop"
      title={PAGE_TITLE}
      description={DESCRIPTION}
      canonical={CANONICAL}
      intro={
        <>
          Docker Desktop is the app that gives a Windows or Mac machine a Docker Engine, the docker
          command line and a dashboard to watch them with. This guide installs it, walks through the
          parts you will use every day, and ends with the one line that runs this site’s lab image
          on your own machine.
        </>
      }
      checked={
        <>
          Docker Desktop changes often, so the release, the subscription terms and the system
          requirements on this page come from Docker’s documentation. They were last checked on{' '}
          <time dateTime={CHECKED_ON.iso}>{CHECKED_ON.label}</time>.
        </>
      }
      links={[
        { label: 'Docker Desktop documentation', href: DOCS.windowsInstall, external: true },
        { label: 'Building the lab image', to: routes.buildingImages('docker') },
        { label: 'The article series on the Docker blog', to: routes.blog('docker') },
        { label: 'See the browser labs', to: staticRoutes.labs },
        { label: 'Back to the Docker hub', to: routes.landing('docker') },
      ]}
    >
      <GuideSection id="before" title="Before you install">
        <p className={PROSE} data-testid="desktop-release">
          The current release is Docker Desktop {CURRENT_RELEASE.version}, published on{' '}
          <time dateTime={CURRENT_RELEASE.date.iso}>{CURRENT_RELEASE.date.label}</time>, which
          bundles Docker Engine {CURRENT_RELEASE.engine}. The{' '}
          <DocLink href={DOCS.releaseNotes}>release notes</DocLink> list every version since.
        </p>
        <p className={PROSE} data-testid="desktop-licence">
          Check the licence before you install it at work. Docker Desktop is free for small
          businesses (fewer than 250 employees and less than $10 million in annual revenue), for
          personal use, for education and for non-commercial open source projects. Professional use
          in a larger organisation needs a paid subscription, as does any government entity, and the
          Docker Pro, Team and Business subscriptions include it. Docker Engine itself is open
          source and its terms are separate.{' '}
          <DocLink href={DOCS.licence}>Docker Desktop licence agreement</DocLink>.
        </p>
        <ul className={`${PROSE} list-disc space-y-2 pl-5`}>
          <li>
            <strong>Windows</strong> on x86_64, with the WSL 2 backend: Windows 11 64-bit
            Enterprise, Pro or Education version 23H2 (build 22631) or later, or Windows 10 64-bit
            Enterprise, Pro or Education 22H2 (build 19045); WSL 2.1.5 or later; 8 GB of RAM; and
            hardware virtualisation turned on in the BIOS or UEFI. Windows Server is not supported.
            The install steps below download the x86_64 installer; Windows on Arm is out of scope
            here.
          </li>
          <li>
            <strong>macOS</strong>: the current macOS release or one of the two before it, and at
            least 4 GB of RAM, on Apple silicon or Intel.
          </li>
        </ul>
      </GuideSection>

      <GuideSection id="windows" title="Install on Windows">
        <p className={PROSE}>
          Docker Desktop runs its engine in WSL 2, so check WSL first. If the command prints no
          version details, you have the old built-in WSL, which needs updating from a PowerShell
          window opened as administrator.
        </p>
        <Commands commands={COMMANDS.wslVersion} testId="commands-wsl-version" />
        <Commands commands={COMMANDS.wslUpdate} testId="commands-wsl-update" />
        <p className={PROSE}>
          Then download the installer to your Downloads folder and run it for your user only, which
          installs to <Code>%LOCALAPPDATA%\Programs\DockerDesktop</Code> and needs no administrator
          rights. Use either the two PowerShell lines or the two Git Bash lines.
        </p>
        <Commands commands={COMMANDS.windowsInstall} testId="commands-windows-install" />
        <p className={PROSE}>
          Docker Desktop does not start by itself after installing. Open it from the Start menu,
          read the Docker Subscription Service Agreement and accept it; the app does not run until
          you do. If you had installed Docker Engine directly inside a WSL Linux distribution,
          Docker’s guidance is to remove it first, because the two conflict.
        </p>
      </GuideSection>

      <GuideSection id="mac" title="Install on macOS">
        <p className={PROSE}>
          Download the disk image for your chip (Apple menu, About This Mac, shows which one you
          have):
        </p>
        <Commands commands={COMMANDS.macDownload} testId="commands-mac-download" />
        <p className={PROSE}>
          Then install it into Applications from the same folder. These lines run the same in zsh,
          the macOS default shell, as in bash. The install step can take several minutes the first
          time, while macOS checks the app.
        </p>
        <Commands commands={COMMANDS.macInstall} testId="commands-mac-install" />
        <p className={PROSE}>
          Open Docker from Applications and accept the agreement. With the default settings the
          docker command line goes in <Code>$HOME/.docker/bin</Code>, which is added to your{' '}
          <Code>PATH</Code>; open a new terminal for it to apply. On Apple silicon, Docker
          recommends Rosetta 2 for the few command-line tools that still need it:
        </p>
        <Commands commands={COMMANDS.rosetta} testId="commands-rosetta" />
        <p className={PROSE}>
          Either way, this confirms the command line can reach the engine. The Server section of the
          output names Docker Desktop and the Engine version under it.
        </p>
        <Commands commands={COMMANDS.version} testId="commands-version" />
      </GuideSection>

      <GuideSection id="dashboard" title="The dashboard: containers, images and volumes">
        <p className={PROSE}>
          The dashboard is what opens with the app. Three views do most of the work, and each has a
          command-line equivalent that shows the same thing.
        </p>
        <ul className={`${PROSE} list-disc space-y-2 pl-5`}>
          <li>
            <strong>Containers</strong> lists running and stopped containers. From a row you can
            start, stop, pause, restart or delete one, open a terminal in it, or copy the{' '}
            <Code>docker run</Code> command that created it. Opening one shows its Logs, Inspect,
            Bind mounts, Files and Stats tabs.
          </li>
          <li>
            <strong>Images</strong> lists the images on disk, marked in use or unused, and lets you
            run one, pull a newer copy, inspect it, and delete the ones you no longer need. An image
            running under emulation carries an architecture chip such as <Code>amd64</Code>, which
            is worth knowing on Apple silicon (see below).
          </li>
          <li>
            <strong>Volumes</strong> lists named volumes, whether a container is using each, and
            their size. You can create, clone, empty, export and import them, and browse the files
            inside.
          </li>
        </ul>
        <Commands commands={COMMANDS.inventory} testId="commands-inventory" />
        <p className={PROSE}>
          Images build up quickly, and this shows how much space images, containers, volumes and the
          build cache take:
        </p>
        <Commands commands={COMMANDS.diskUsage} testId="commands-disk-usage" />
      </GuideSection>

      <GuideSection id="settings" title="The settings that matter for the labs">
        <p className={PROSE}>
          <strong>The WSL 2 backend (Windows).</strong> On a machine that supports it, Docker
          Desktop uses the WSL 2 based engine by default, and the switch under Settings, General may
          not even be shown. The engine runs in its own WSL distribution, called{' '}
          <Code>docker-desktop</Code>, kept apart from any Linux distributions you have installed,
          and its data lives under <Code>%LOCALAPPDATA%\Docker\wsl</Code> unless you move it under
          Settings, Resources, Advanced. If you want docker inside your own Ubuntu as well, turn it
          on for that distribution under Settings, Resources, WSL Integration.
        </p>
        <p className={PROSE}>
          <strong>Resource limits.</strong> On a Mac, Settings, Resources, Advanced sets the CPU
          limit, the memory limit (half the machine’s memory by default), swap (1 GB by default) and
          a disk usage limit. With the WSL 2 backend those settings are not in Docker Desktop: WSL 2
          decides, and by default it lets its VM use up to half of Windows’ memory and every logical
          processor. To cap it, set <Code>memory</Code> and <Code>processors</Code> under{' '}
          <Code>[wsl2]</Code> in <Code>.wslconfig</Code> in your user profile. The values below are
          the example in{' '}
          <DocLink href={DOCS.wslConfig}>Microsoft’s WSL configuration guide</DocLink>, which also
          offers the WSL Settings app in the Start menu as another way to set them.
        </p>
        <Commands commands={COMMANDS.editWslConfig} testId="commands-edit-wslconfig" />
        <div className="flex max-w-3xl flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-slate-600 dark:text-slate-400">
            .wslconfig
          </span>
          <pre className="overflow-x-auto rounded-lg border border-slate-300 bg-slate-950 px-3 py-2 text-xs text-slate-100 dark:border-slate-700">
            <code data-testid="wslconfig-example">{WSLCONFIG_EXAMPLE}</code>
          </pre>
        </div>
        <p className={PROSE}>
          Save the file, quit Docker Desktop, and stop WSL so the new limits apply when it starts
          again. This stops every running WSL distribution, not only Docker’s.
        </p>
        <Commands commands={COMMANDS.wslShutdown} testId="commands-wsl-shutdown" />
        <p className={PROSE}>
          For comparison, a browser lab workspace is limited to one CPU and 2 GB of memory.{' '}
          <strong>Resource Saver</strong>, on by default and set under the same Resources settings,
          steps in after five minutes with no containers running. On macOS it stops Docker’s Linux
          VM, freeing its memory, and starts it again for the next container, which takes about 3 to
          10 seconds. On Windows with WSL 2 it only pauses Docker Engine inside the{' '}
          <Code>docker-desktop</Code> distribution: CPU use drops and the next container starts
          straight away, but the memory WSL holds is not given back unless WSL’s{' '}
          <Code>autoMemoryReclaim</Code> setting is on. With WSL integration turned on for a
          distribution, Docker Desktop counts that as activity and does not enter it.
        </p>
      </GuideSection>

      <GuideSection id="lab-image" title="Run the lab image">
        <p className={PROSE}>
          Every lab on this site has a “Run it locally” line, and it is the same line for all of
          them: it starts the lab image with the folder you are in mounted at{' '}
          <Code>/workspace</Code>, and drops you into a bash prompt there. <Code>-it</Code> makes it
          interactive and <Code>--rm</Code> removes the container when you type <Code>exit</Code>;
          your files stay in your folder. Pick the line for your shell: the quoting differs, and
          each one pasted at the other prompt mounts the wrong folder. On Windows, use the
          PowerShell line.
        </p>
        <Commands commands={RUN_LOCALLY_COMMANDS} testId="commands-run-locally" />
        <p className={PROSE}>
          The first run downloads the image: 497 MB compressed and 2.73 GB on disk when it was last
          measured, on 27 September 2026. To fetch it ahead of time, pull it. You can then see it in
          the Images view and the running container in Containers.
        </p>
        <Commands commands={COMMANDS.pull} testId="commands-pull" />
        <p className={PROSE}>
          A good start is a <Code>nobody@</Code> prompt ending in <Code>/workspace$</Code>, where{' '}
          <Code>terraform version</Code> answers. The image is built for linux/amd64 only, so on
          Apple silicon it runs under emulation and Docker prints a platform warning first; it
          works, more slowly. If your Docker Desktop runs on the Apple Virtualization framework, the
          setting “Use Rosetta for x86_64/amd64 emulation on Apple Silicon” speeds that up.
        </p>
      </GuideSection>

      <GuideSection id="engine" title="Desktop and Docker Engine on the lab host">
        <p className={PROSE}>
          Docker Desktop is not the engine; it carries one. On Windows and macOS it runs Docker
          Engine inside a small Linux VM it manages for you, the <Code>docker-desktop</Code> WSL
          distribution on Windows, and adds the docker command line, Docker Build, Docker Compose,
          the dashboard and the settings above. The docker commands you type talk to that engine.
        </p>
        <p className={PROSE}>
          The Hybrid Lab host behind the browser labs is a Linux server, so it needs none of that.
          It runs Docker Engine directly, from Docker’s own packages, with no app, no dashboard and
          no VM in between, and Docker Desktop’s subscription terms do not apply to it. Each lab
          workspace is a container started from the same lab image you just ran. That is the point
          of the image: the engine underneath is the same open-source Docker Engine, so a lab that
          works in a container on your laptop works the same way in a browser workspace, and the
          other way round.
        </p>
      </GuideSection>
    </DockerGuide>
  );
}
