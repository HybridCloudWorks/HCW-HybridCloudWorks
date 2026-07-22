import NewsPage from '@/pages/shared/NewsPage';
import ComingSoonPage from '@/pages/ComingSoonPage'; // TODO: remove to re-enable

export default function GitHubRssPage() {
  return <ComingSoonPage />; // TODO: remove to re-enable
  return <NewsPage provider="github" />;
}
