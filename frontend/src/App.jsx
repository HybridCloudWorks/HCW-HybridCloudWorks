import React, { Suspense, lazy, useEffect, useState } from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation,
  useParams,
} from 'react-router';
import ScrollToTop from '@/components/shared/ScrollToTop';
import Header from '@/components/shared/Header';
import Footer from '@/components/shared/Footer';
import { VALID_PROVIDERS, ProviderLayout } from '@/context/ProviderContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { useAuthRedirectLanding } from '@/hooks/useAuthRedirectLanding';

const lazyPage = (loader) => lazy(loader);

// --- Lazy Load Pages ---

// Shared
const HomePage = lazyPage(() => import('@/pages/shared/HomePage'));
const AboutPage = lazyPage(() => import('@/pages/shared/AboutPage'));
const ContactPage = lazyPage(() => import('@/pages/shared/ContactPage'));
const NewsPage = lazyPage(() => import('@/pages/shared/NewsPage'));
const SharedPodcastPage = lazyPage(() => import('@/pages/shared/PodcastPage'));
const NotFoundPage = lazyPage(() => import('@/pages/NotFoundPage'));
const ThemeToggleButton = lazyPage(() => import('@/components/shared/ThemeToggleButton'));
const Toaster = lazyPage(() =>
  import('@/components/ui/toaster').then((module) => ({ default: module.Toaster }))
);

// AWS
const AWSLandingPage = lazyPage(() => import('@/pages/aws/LandingPage'));
const AWSArchitecturePage = lazyPage(() => import('@/pages/aws/ArchitecturePage'));
const AWSFrameworksPage = lazyPage(() => import('@/pages/aws/FrameworksPage'));
const AWSBlogPage = lazyPage(() => import('@/pages/aws/BlogPage'));
const AWSEducationPage = lazyPage(() => import('@/pages/aws/EducationPage'));
const AWSCertDetailPage = lazyPage(() => import('@/pages/aws/education/CertDetailPage'));
const AWSMicrocredentialDetailPage = lazyPage(
  () => import('@/pages/aws/education/MicrocredentialDetailPage')
);
const AWSPodcastPage = lazyPage(() => import('@/pages/aws/PodcastPage'));
const AWSRssPage = lazyPage(() => import('@/pages/aws/RssPage'));

// Azure
const AzureLandingPage = lazyPage(() => import('@/pages/azure/LandingPage'));
const AzureArchitecturePage = lazyPage(() => import('@/pages/azure/ArchitecturePage'));
const AzureFrameworksPage = lazyPage(() => import('@/pages/azure/FrameworksPage'));
const AzureBlogPage = lazyPage(() => import('@/pages/azure/BlogPage'));
const AzureEducationPage = lazyPage(() => import('@/pages/azure/EducationPage'));
const AzureCertDetailPage = lazyPage(() => import('@/pages/azure/education/CertDetailPage'));
const AzurePodcastPage = lazyPage(() => import('@/pages/azure/PodcastPage'));
const AzureRssPage = lazyPage(() => import('@/pages/azure/RssPage'));

// GCP
const GCPLandingPage = lazyPage(() => import('@/pages/gcp/LandingPage'));
const GCPArchitecturePage = lazyPage(() => import('@/pages/gcp/ArchitecturePage'));
const GCPFrameworksPage = lazyPage(() => import('@/pages/gcp/FrameworksPage'));
const GCPBlogPage = lazyPage(() => import('@/pages/gcp/BlogPage'));
const GCPEducationPage = lazyPage(() => import('@/pages/gcp/EducationPage'));
const GCPPodcastPage = lazyPage(() => import('@/pages/gcp/PodcastPage'));
const GCPRssPage = lazyPage(() => import('@/pages/gcp/RssPage'));

// FinOps
const FinOpsLandingPage = lazyPage(() => import('@/pages/finops/LandingPage'));
const FinOpsToolsPage = lazyPage(() => import('@/pages/finops/ToolsPage'));
const FinOpsFocusPage = lazyPage(() => import('@/pages/finops/FocusPage'));
const FinOpsArchitecturePage = lazyPage(() => import('@/pages/finops/ArchitecturePage'));
const FinOpsBlogPage = lazyPage(() => import('@/pages/finops/BlogPage'));
const FinOpsFrameworksPage = lazyPage(() => import('@/pages/finops/FrameworksPage'));
const FinOpsEducationPage = lazyPage(() => import('@/pages/finops/EducationPage'));
const FinOpsRssPage = lazyPage(() => import('@/pages/finops/RssPage'));

// Terraform
const TerraformLandingPage = lazyPage(() => import('@/pages/terraform/LandingPage'));
const TerraformCodePage = lazyPage(() => import('@/pages/terraform/CodePage'));
const TerraformModulesPage = lazyPage(() => import('@/pages/terraform/ModulesPage'));
const TerraformToolsPage = lazyPage(() => import('@/pages/terraform/ToolsPage'));
const TerraformBlogPage = lazyPage(() => import('@/pages/terraform/BlogPage'));
const TerraformRssPage = lazyPage(() => import('@/pages/terraform/RssPage'));
const TerraformEducationPage = lazyPage(() => import('@/pages/terraform/EducationPage'));

// GitHub
const GitHubLandingPage = lazyPage(() => import('@/pages/github/LandingPage'));
const GitHubWorkflowsPage = lazyPage(() => import('@/pages/github/WorkflowsPage'));
const GitHubCodePage = lazyPage(() => import('@/pages/github/CodePage'));
const GitHubToolsPage = lazyPage(() => import('@/pages/github/ToolsPage'));
const GitHubBlogPage = lazyPage(() => import('@/pages/github/BlogPage'));
const GitHubRssPage = lazyPage(() => import('@/pages/github/RssPage'));
const GitHubEducationPage = lazyPage(() => import('@/pages/github/EducationPage'));

// VMware
const VMwareLandingPage = lazyPage(() => import('@/pages/vmware/LandingPage'));
const VMwareArchitecturePage = lazyPage(() => import('@/pages/vmware/ArchitecturePage'));
const VMwareFrameworksPage = lazyPage(() => import('@/pages/vmware/FrameworksPage'));
const VMwareBlogPage = lazyPage(() => import('@/pages/vmware/BlogPage'));
const VMwareEducationPage = lazyPage(() => import('@/pages/vmware/EducationPage'));
const VMwarePodcastPage = lazyPage(() => import('@/pages/vmware/PodcastPage'));
const VMwareRssPage = lazyPage(() => import('@/pages/vmware/RssPage'));

// Ansible
const AnsibleLandingPage = lazyPage(() => import('@/pages/ansible/LandingPage'));
const AnsibleCodePage = lazyPage(() => import('@/pages/ansible/CodePage'));
const AnsibleBlogPage = lazyPage(() => import('@/pages/ansible/BlogPage'));
const AnsibleEducationPage = lazyPage(() => import('@/pages/ansible/EducationPage'));
const AnsibleRssPage = lazyPage(() => import('@/pages/ansible/RssPage'));

// Coder Corner (shared public list page)
const ProviderCoderCornerPage = lazyPage(
  () => import('@/components/shared/ProviderCoderCornerPage')
);

// Cloud Tools
const ToolsMigrationPage = lazyPage(() => import('@/pages/tools/MigrationPage'));
const ToolsComparisonPage = lazyPage(() => import('@/pages/tools/ComparisonPage'));
const ToolsResourcesPage = lazyPage(() => import('@/pages/tools/ResourcesPage'));
const ToolsDecisionsPage = lazyPage(() => import('@/pages/tools/DecisionsPage'));

// Templates
const FrameworkSubmissionPage = lazyPage(
  () => import('@/pages/submissions/FrameworkSubmissionPage')
);
const ArchitectureSubmissionPage = lazyPage(
  () => import('@/pages/submissions/ArchitectureSubmissionPage')
);
const BlogSubmissionPage = lazyPage(() => import('@/pages/submissions/BlogSubmissionPage'));
const CoderCornerSubmissionPage = lazyPage(
  () => import('@/pages/submissions/CoderCornerSubmissionPage')
);
const ArchitectureDetailTemplate = lazyPage(
  () => import('@/components/templates/ArchitectureDetailTemplate')
);
const FrameworkDetailTemplate = lazyPage(
  () => import('@/components/templates/FrameworkDetailTemplate')
);
const BlogDetailTemplate = lazyPage(() => import('@/components/templates/BlogDetailTemplate'));
const PreviewPage = lazyPage(() => import('@/pages/PreviewPage'));
const RosettaStoneSubmissionPage = lazyPage(
  () => import('@/pages/submissions/RosettaStoneSubmissionPage')
);

// Admin
const AdminAuthGuard = lazyPage(() => import('@/pages/admin/AdminAuthGuard'));
const AdminLayout = lazyPage(() => import('@/pages/admin/AdminLayout'));
const AdminDashboardPage = lazyPage(() => import('@/pages/admin/DashboardPage'));
const AdminQueuePage = lazyPage(() => import('@/pages/admin/QueuePage'));
const AdminReviewPage = lazyPage(() => import('@/pages/admin/ReviewPage'));
const AdminEditorPage = lazyPage(() => import('@/pages/admin/EditorPage'));
const AdminEditorListPage = lazyPage(() => import('@/pages/admin/EditorListPage'));
const AdminSubmitUrlsPage = lazyPage(() => import('@/pages/admin/SubmitUrlsPage'));
const AdminPublishedPage = lazyPage(() => import('@/pages/admin/PublishedPage'));
const AdminLivePagesPage = lazyPage(() => import('@/pages/admin/LivePagesPage'));
const AdminCalendarPage = lazyPage(() => import('@/pages/admin/CalendarPage'));
const AdminImagePromptsPage = lazyPage(() => import('@/pages/admin/ImagePromptsPage'));
const AdminImageGalleryPage = lazyPage(() => import('@/pages/admin/ImageGalleryPage'));
const AdminOpsHealthPage = lazyPage(() => import('@/pages/admin/OpsHealthPage'));
const AdminFrameworksPage = lazyPage(() => import('@/pages/admin/FrameworksPage'));
const AdminCoderCornerPage = lazyPage(() => import('@/pages/admin/CoderCornerPage'));
const AdminSpeakingEventsPage = lazyPage(() => import('@/pages/admin/SpeakingEventsPage'));
const AdminCertificationsPage = lazyPage(() => import('@/pages/admin/CertificationsPage'));
const AdminSocialHubPage = lazyPage(() => import('@/pages/admin/SocialHubPage'));
const AdminRecordingsPage = lazyPage(() => import('@/pages/admin/RecordingsPage'));
const AdminAIEnginePage = lazyPage(() => import('@/pages/admin/AIEnginePage'));
const AdminServiceDocsPage = lazyPage(() => import('@/pages/admin/ServiceDocsPage'));
const AdminForgeStudioPage = lazyPage(() => import('@/pages/admin/ForgeStudioPage'));
const AdminLinkiePage = lazyPage(() => import('@/pages/admin/LinkiePage'));
const AdminMailingListPage = lazyPage(() => import('@/pages/admin/MailingListPage'));
const AdminConnectionsPage = lazyPage(() => import('@/pages/admin/ConnectionsPage'));
const AdminLabsPage = lazyPage(() => import('@/pages/admin/LabsPage'));
const AdminListenAndLearnPage = lazyPage(() => import('@/pages/admin/ListenAndLearnPage'));

// Placeholder loader
const PageLoader = () => (
  <div className="flex items-center justify-center min-h-[50vh]">
    <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-slate-blue"></div>
  </div>
);

class RouteErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const { isAdminRoute } = this.props;

    return (
      <div className="flex min-h-[50vh] items-center justify-center px-4 py-10">
        <div className="w-full max-w-lg rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
          <h2 className="text-xl font-semibold">Page load failed</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            A required module failed to load. This is usually caused by an out-of-date cached page
            referencing old build chunks.
          </p>
          {isAdminRoute && (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 sm:w-auto"
              >
                Hard Refresh Admin
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }
}

function App() {
  const location = useLocation();
  // A sign-in that lands on `/` has to be finishable from `/`. The redirect URI
  // is the origin, and nothing at the origin used to touch MSAL — see the hook.
  useAuthRedirectLanding();
  const [, firstSegment] = location.pathname.split('/');
  const provider = VALID_PROVIDERS.includes(firstSegment) ? firstSegment : null;
  const isAdminRoute = firstSegment === 'admin';
  // Derived rather than synced from the effect below. Admin routes need the
  // deferred chrome immediately, and once idle time has been reached we keep it
  // on; expressing that as `isAdminRoute || idleReached` avoids calling setState
  // synchronously inside the effect, which triggers a cascading render.
  const [idleReached, setIdleReached] = useState(isAdminRoute);
  const showDeferredUi = isAdminRoute || idleReached;

  useEffect(() => {
    // Nothing to schedule on admin routes — showDeferredUi is already true.
    if (isAdminRoute) return undefined;

    let cancelled = false;
    let timeoutId = null;
    const activate = () => {
      if (!cancelled) setIdleReached(true);
    };

    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      const idleId = window.requestIdleCallback(activate, { timeout: 2000 });
      return () => {
        cancelled = true;
        window.cancelIdleCallback?.(idleId);
      };
    }

    timeoutId = window.setTimeout(activate, 1500);
    return () => {
      cancelled = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [isAdminRoute]);

  return (
    <div
      className={`min-h-screen flex flex-col relative bg-background text-foreground ${
        provider ? `theme-${provider}` : ''
      }`}
    >
      <div className="fixed inset-0 w-full h-full bg-grid-pattern -z-20 opacity-20 dark:opacity-50"></div>

      {!isAdminRoute && <Header />}

      <ScrollToTop />
      <main id="main-content" tabIndex={-1} className="grow">
        <RouteErrorBoundary isAdminRoute={isAdminRoute}>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              {/* --- Root & Shared --- */}
              <Route path="/" element={<HomePage />} />
              <Route path="/about" element={<AboutPage />} />
              <Route path="/contact" element={<ContactPage />} />
              {/* --- Provider Routes (Wrapped in ProviderLayout) --- */}
              <Route path="/:provider" element={<ProviderLayout />}>
                <Route index element={<ProviderLandingDispatcher />} />
                {/* Shared paths across providers */}
                <Route path="blog" element={<ProviderBlogDispatcher />} />
                <Route path="blog/:slug" element={<ProviderBlogDetailDispatcher />} />
                <Route path="news/:slug" element={<ProviderNewsDetailDispatcher />} />
                <Route path="architecture-designs" element={<ProviderArchitectureDispatcher />} />
                <Route
                  path="architecture-designs/:slug"
                  element={<ProviderArchitectureDispatcher />}
                />
                <Route path="frameworks" element={<ProviderFrameworksDispatcher />} />
                <Route path="frameworks/:slug" element={<ProviderFrameworksDispatcher />} />
                <Route path="code" element={<ProviderCodeDispatcher />} />
                <Route path="code/:slug" element={<ProviderCodeDispatcher />} />
                <Route path="coder-corner" element={<ProviderCoderCornerDispatcher />} />
                <Route path="coder-corner/:slug" element={<ProviderCoderCornerDispatcher />} />
                <Route path="education" element={<ProviderEducationDispatcher />} />
                <Route path="education/:certSlug" element={<ProviderEducationDetailDispatcher />} />
                <Route
                  path="education/microcredentials/:mcSlug"
                  element={<ProviderMicrocredentialDetailDispatcher />}
                />
                <Route path="audio-architecture" element={<ProviderAudioDispatcher />} />
                <Route path="audio" element={<ProviderAudioDispatcher />} />
                <Route path="news" element={<ProviderRssDispatcher />} />
                <Route path="rss" element={<ProviderRssDispatcher />} />
                {/* Fallback for provider sub-routes */}
                <Route path="*" element={<NotFoundPage />} />
              </Route>
              {/* --- Dedicated Section Routes (FinOps, Terraform, GitHub) --- */}
              {/* AWS Specifics */}
              {/* Azure Specifics */}
              {/* GCP Specifics */}
              {/* FinOps Specifics */}
              <Route path="/finops/tools" element={<FinOpsToolsPage />} />
              <Route path="/finops/focus" element={<FinOpsFocusPage />} />
              <Route path="/finops/architectures" element={<FinOpsArchitecturePage />} />
              <Route path="/finops/architecture-designs" element={<FinOpsArchitecturePage />} />
              {/* Terraform Specifics */}
              <Route path="/terraform/code" element={<TerraformCodePage />} />
              <Route path="/terraform/modules" element={<TerraformModulesPage />} />
              <Route path="/terraform/tools" element={<TerraformToolsPage />} />
              {/* GitHub Specifics */}
              <Route path="/github/workflows" element={<GitHubWorkflowsPage />} />
              <Route path="/github/code" element={<GitHubCodePage />} />
              <Route path="/github/tools" element={<GitHubToolsPage />} />
              {/* --- Cloud Tools --- */}
              <Route path="/tools/migration" element={<ToolsMigrationPage />} />
              <Route path="/tools/comparison" element={<ToolsComparisonPage />} />
              <Route path="/tools/resources" element={<ToolsResourcesPage />} />
              <Route path="/tools/decisions" element={<ToolsDecisionsPage />} />
              {/* --- Staging preview (T-606): signed-link view of unpublished
                  drafts. Static segment outranks /:provider in route ranking. --- */}
              <Route path="/preview/:id" element={<PreviewPage />} />
              {/* --- Templates --- */}
              <Route path="/templates/framework" element={<FrameworkSubmissionPage />} />
              <Route path="/templates/architecture" element={<ArchitectureSubmissionPage />} />
              <Route path="/templates/blog" element={<BlogSubmissionPage />} />
              <Route path="/templates/coder-corner" element={<CoderCornerSubmissionPage />} />
              <Route path="/templates/rosetta-stone" element={<RosettaStoneSubmissionPage />} />
              {/* --- Admin CMS --- */}
              <Route
                path="/admin"
                element={
                  <AdminAuthGuard>
                    <AdminLayout />
                  </AdminAuthGuard>
                }
              >
                <Route index element={<AdminDashboardPage />} />
                <Route path="queue" element={<AdminQueuePage />} />
                <Route path="queue/:blogId" element={<AdminReviewPage />} />
                <Route path="editor" element={<AdminEditorListPage />} />
                <Route path="editor/:blogId" element={<AdminEditorPage />} />
                <Route path="submit" element={<AdminSubmitUrlsPage />} />
                <Route path="published" element={<AdminPublishedPage />} />
                <Route path="live-pages" element={<AdminLivePagesPage />} />
                <Route path="calendar" element={<AdminCalendarPage />} />
                <Route path="frameworks" element={<AdminFrameworksPage />} />
                <Route path="coder-corner" element={<AdminCoderCornerPage />} />
                <Route path="speaking-events" element={<AdminSpeakingEventsPage />} />
                <Route path="certifications" element={<AdminCertificationsPage />} />
                <Route path="image-prompts" element={<AdminImagePromptsPage />} />
                <Route path="image-gallery" element={<AdminImageGalleryPage />} />
                <Route path="ops-health" element={<AdminOpsHealthPage />} />
                <Route path="social" element={<AdminSocialHubPage />} />
                <Route path="recordings" element={<AdminRecordingsPage />} />
                <Route path="forge-studio" element={<AdminForgeStudioPage />} />
                <Route path="ai-engine" element={<AdminAIEnginePage />} />
                <Route path="ai-engine/docs/:serviceId" element={<AdminServiceDocsPage />} />
                <Route path="linkie" element={<AdminLinkiePage />} />
                <Route path="mailing-list" element={<AdminMailingListPage />} />
                <Route path="connections" element={<AdminConnectionsPage />} />
                <Route path="labs" element={<AdminLabsPage />} />
                <Route path="listen-and-learn" element={<AdminListenAndLearnPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
              {/* Catch-All */}
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </RouteErrorBoundary>
      </main>

      {!isAdminRoute && <Footer />}

      {showDeferredUi && (
        <Suspense fallback={null}>
          <ThemeToggleButton
            variant="outline"
            size="icon"
            className="fixed bottom-5 right-5 z-70 h-11 w-11 rounded-full border-border bg-background/90 text-foreground shadow-lg backdrop-blur supports-backdrop-filter:bg-background/75"
          />
        </Suspense>
      )}

      {showDeferredUi && (
        <Suspense fallback={null}>
          <Toaster />
        </Suspense>
      )}
    </div>
  );
}

// --- Dispatch Components to handle /:provider/... rendering ---

function ProviderLandingDispatcher() {
  const { provider } = useParams();
  if (provider === 'aws') return <AWSLandingPage />;
  if (provider === 'azure') return <AzureLandingPage />;
  if (provider === 'gcp') return <GCPLandingPage />;
  if (provider === 'finops') return <FinOpsLandingPage />;
  if (provider === 'terraform') return <TerraformLandingPage />;
  if (provider === 'github') return <GitHubLandingPage />;
  if (provider === 'vmware') return <VMwareLandingPage />;
  if (provider === 'ansible') return <AnsibleLandingPage />;
  return <NotFoundPage />;
}

function ProviderBlogDispatcher() {
  const { provider } = useParams();
  if (provider === 'aws') return <AWSBlogPage />;
  if (provider === 'azure') return <AzureBlogPage />;
  if (provider === 'gcp') return <GCPBlogPage />;
  if (provider === 'finops') return <FinOpsBlogPage />;
  if (provider === 'terraform') return <TerraformBlogPage />;
  if (provider === 'github') return <GitHubBlogPage />;
  if (provider === 'vmware') return <VMwareBlogPage />;
  if (provider === 'ansible') return <AnsibleBlogPage />;
  return <NotFoundPage />;
}

function ProviderBlogDetailDispatcher() {
  const { provider } = useParams();
  if (provider === 'aws') return <BlogDetailTemplate provider="aws" />;
  if (provider === 'azure') return <BlogDetailTemplate provider="azure" />;
  if (provider === 'gcp') return <BlogDetailTemplate provider="gcp" />;
  if (provider === 'finops') return <BlogDetailTemplate provider="finops" />;
  if (provider === 'terraform') return <BlogDetailTemplate provider="terraform" />;
  if (provider === 'github') return <BlogDetailTemplate provider="github" />;
  if (provider === 'vmware') return <BlogDetailTemplate provider="vmware" />;
  if (provider === 'ansible') return <BlogDetailTemplate provider="ansible" />;
  return <NotFoundPage />;
}

function ProviderNewsDetailDispatcher() {
  const { provider } = useParams();
  if (provider === 'aws') return <BlogDetailTemplate provider="aws" section="news" />;
  if (provider === 'azure') return <BlogDetailTemplate provider="azure" section="news" />;
  if (provider === 'gcp') return <BlogDetailTemplate provider="gcp" section="news" />;
  if (provider === 'finops') return <BlogDetailTemplate provider="finops" section="news" />;
  if (provider === 'terraform') return <BlogDetailTemplate provider="terraform" section="news" />;
  if (provider === 'github') return <BlogDetailTemplate provider="github" section="news" />;
  if (provider === 'vmware') return <BlogDetailTemplate provider="vmware" section="news" />;
  if (provider === 'ansible') return <BlogDetailTemplate provider="ansible" section="news" />;
  return <NotFoundPage />;
}

function ProviderArchitectureDispatcher() {
  const { provider } = useParams();
  const { pathname } = useLocation();
  const segment = pathname.split('/').filter(Boolean).pop();
  const isDetail = segment !== 'architecture-designs';

  if (provider === 'aws') {
    return isDetail ? <ArchitectureDetailTemplate provider="aws" /> : <AWSArchitecturePage />;
  }
  if (provider === 'azure') {
    return isDetail ? <ArchitectureDetailTemplate provider="azure" /> : <AzureArchitecturePage />;
  }
  if (provider === 'gcp') {
    return isDetail ? <ArchitectureDetailTemplate provider="gcp" /> : <GCPArchitecturePage />;
  }
  if (provider === 'finops') {
    return isDetail ? <ArchitectureDetailTemplate provider="finops" /> : <FinOpsArchitecturePage />;
  }
  if (provider === 'vmware') {
    return isDetail ? <ArchitectureDetailTemplate provider="vmware" /> : <VMwareArchitecturePage />;
  }
  return <NotFoundPage />;
}

function ProviderFrameworksDispatcher() {
  const { provider } = useParams();
  const { pathname } = useLocation();
  const segment = pathname.split('/').filter(Boolean).pop();
  const isDetail = segment !== 'frameworks';

  if (provider === 'aws') {
    return isDetail ? <FrameworkDetailTemplate provider="aws" /> : <AWSFrameworksPage />;
  }
  if (provider === 'azure') {
    return isDetail ? <FrameworkDetailTemplate provider="azure" /> : <AzureFrameworksPage />;
  }
  if (provider === 'gcp') {
    return isDetail ? <FrameworkDetailTemplate provider="gcp" /> : <GCPFrameworksPage />;
  }
  if (provider === 'finops') {
    return isDetail ? <FrameworkDetailTemplate provider="finops" /> : <FinOpsFrameworksPage />;
  }
  if (provider === 'vmware') {
    return isDetail ? <FrameworkDetailTemplate provider="vmware" /> : <VMwareFrameworksPage />;
  }
  return <NotFoundPage />;
}

function ProviderCodeDispatcher() {
  const { provider } = useParams();
  const { pathname } = useLocation();
  const segment = pathname.split('/').filter(Boolean).pop();
  const isDetail = segment !== 'code';

  if (provider === 'github') {
    return isDetail ? <BlogDetailTemplate provider="github" section="code" /> : <GitHubCodePage />;
  }
  if (provider === 'terraform') {
    return isDetail ? (
      <BlogDetailTemplate provider="terraform" section="code" />
    ) : (
      <TerraformCodePage />
    );
  }
  if (provider === 'ansible') {
    return isDetail ? (
      <BlogDetailTemplate provider="ansible" section="code" />
    ) : (
      <AnsibleCodePage />
    );
  }

  return <NotFoundPage />;
}

function ProviderCoderCornerDispatcher() {
  const { provider, slug } = useParams();
  if (!VALID_PROVIDERS.includes(provider)) return <NotFoundPage />;
  if (slug) {
    return <BlogDetailTemplate provider={provider} section="coder-corner" />;
  }
  return <ProviderCoderCornerPage provider={provider} />;
}

function ProviderEducationDispatcher() {
  const { provider } = useParams();
  if (provider === 'aws') return <AWSEducationPage />;
  if (provider === 'azure') return <AzureEducationPage />;
  if (provider === 'gcp') return <GCPEducationPage />;
  if (provider === 'finops') return <FinOpsEducationPage />;
  if (provider === 'github') return <GitHubEducationPage />;
  if (provider === 'terraform') return <TerraformEducationPage />;
  if (provider === 'vmware') return <VMwareEducationPage />;
  if (provider === 'ansible') return <AnsibleEducationPage />;
  return <NotFoundPage />;
}

function ProviderEducationDetailDispatcher() {
  const { provider } = useParams();
  if (provider === 'aws') return <AWSCertDetailPage />;
  if (provider === 'azure') return <AzureCertDetailPage />;
  // Providers without dedicated cert-detail pages fall back to their
  // education hub instead of dead-ending on a 404.
  if (['gcp', 'finops', 'terraform', 'github', 'vmware', 'ansible'].includes(provider)) {
    return <Navigate to={`/${provider}/education`} replace />;
  }
  return <NotFoundPage />;
}

function ProviderMicrocredentialDetailDispatcher() {
  const { provider } = useParams();
  if (provider === 'aws') return <AWSMicrocredentialDetailPage />;
  return <NotFoundPage />;
}

function ProviderAudioDispatcher() {
  const { provider } = useParams();
  if (provider === 'aws') return <AWSPodcastPage />;
  if (provider === 'azure') return <AzurePodcastPage />;
  if (provider === 'gcp') return <GCPPodcastPage />;
  if (provider === 'github') return <SharedPodcastPage />;
  if (provider === 'terraform') return <SharedPodcastPage />;
  if (provider === 'finops') return <SharedPodcastPage />;
  if (provider === 'vmware') return <VMwarePodcastPage />;
  if (provider === 'ansible') return <SharedPodcastPage />;
  return <NotFoundPage />;
}

function ProviderRssDispatcher() {
  const { provider } = useParams();
  if (provider === 'aws') return <AWSRssPage />;
  if (provider === 'azure') return <AzureRssPage />;
  if (provider === 'gcp') return <GCPRssPage />;
  if (provider === 'finops') return <FinOpsRssPage />;
  if (provider === 'terraform') return <TerraformRssPage />;
  if (provider === 'github') return <GitHubRssPage />;
  if (provider === 'vmware') return <VMwareRssPage />;
  if (provider === 'ansible') return <AnsibleRssPage />;
  return <NewsPage provider={provider} />;
}

/**
 * Everything the application needs that is NOT the router.
 *
 * Split out so the browser entry and the pre-render step share one list. They
 * mount different routers — `BrowserRouter` here, `StaticRouter` under Node —
 * and before this existed the only way to render the tree on a server was to
 * rebuild the provider stack alongside it, which is a copy that silently stops
 * matching the moment anyone adds a provider.
 */
export function AppProviders({ children }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

/** The routed application, without a router. The pre-render entry supplies its own. */
export { App };

function AppWrapper() {
  return (
    <AppProviders>
      <Router
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <App />
      </Router>
    </AppProviders>
  );
}

export default AppWrapper;
