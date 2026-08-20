import { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { loadGalleryItems, getSourceLabel } from '@/lib/imageGallery';
import { resolveMediaUrl } from '../../lib/functionsBase';

export function ImageGalleryPicker({ onSelect, provider = '', title = 'Add From Image Gallery' }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');

  const loadItems = async ({ silent = false } = {}) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const nextItems = await loadGalleryItems();
      setItems(nextItems);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      loadItems();
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const normalizedProvider = provider.trim().toLowerCase();

    return items.filter((item) => {
      const providerMatch =
        !normalizedProvider ||
        String(item.provider || '')
          .trim()
          .toLowerCase() === normalizedProvider;
      if (!providerMatch) return false;
      if (!normalizedQuery) return true;

      const haystack = [
        item.title,
        item.provider,
        item.slot,
        item.articleId,
        getSourceLabel(item.sourceCollection),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [items, provider, query]);

  const showEmptyState = loading || filteredItems.length === 0;
  const emptyStateMessage = loading ? 'Loading gallery...' : 'No gallery images match this filter.';

  return (
    <div className="rounded-lg border border-border p-3 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">{title}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => loadItems({ silent: true })}
        >
          {refreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </div>

      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search gallery by title, provider, slot..."
      />

      {showEmptyState ? (
        <p className="text-sm text-muted-foreground">{emptyStateMessage}</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-96 overflow-y-auto pr-1">
          {filteredItems.slice(0, 24).map((item) => (
            <div key={item.id} className="rounded-md border border-border p-2 space-y-2">
              <img
                src={resolveMediaUrl(item.imageUrl)}
                alt={item.title || item.articleId}
                className="h-28 w-full rounded object-cover"
              />
              <div className="flex flex-wrap gap-1">
                <Badge variant="outline" className="text-[10px]">
                  {getSourceLabel(item.sourceCollection)}
                </Badge>
                {item.provider && (
                  <Badge variant="secondary" className="text-[10px]">
                    {item.provider}
                  </Badge>
                )}
                {item.slot && (
                  <Badge variant="secondary" className="text-[10px]">
                    {item.slot}
                  </Badge>
                )}
              </div>
              <p className="text-xs font-medium truncate">{item.title || item.articleId}</p>
              <Button type="button" size="sm" className="w-full" onClick={() => onSelect(item)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Image
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default ImageGalleryPicker;
