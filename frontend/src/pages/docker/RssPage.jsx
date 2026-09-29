import NewsPage from '@/pages/shared/NewsPage';

// The shared news page (#777), fed by Docker's blog feed
// (functions/src/lib/rss/feeds.js); its NEWS_META row is Docker's.
export default function DockerRssPage() {
  return <NewsPage provider="docker" />;
}
