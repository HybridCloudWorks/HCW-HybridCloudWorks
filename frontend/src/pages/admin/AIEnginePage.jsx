/**
 * AI Engine — Admin Page  (/admin/ai-engine)
 *
 * Four tabs:
 *   1. AI Services   — provider cards with status, enable toggle, model selector, Test button
 *   2. MCP Servers   — server cards with tool browser, enable toggle, Sync / Test buttons, Add Server form
 *   3. Playground    — pick provider or MCP tool, compose messages, see response + cost
 *   4. Usage         — token usage chart + estimated cost by provider, recent call log
 */

import React, { useEffect, useState, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import {
  Bot,
  Server,
  FlaskConical,
  BarChart2,
  Clock,
  Loader2,
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  RefreshCw,
  Play,
  Send,
  ExternalLink,
  Info,
  DollarSign,
  BookOpen,
  Layers,
  CheckSquare,
  Square,
  ArrowUp,
  ArrowDown,
  ToggleLeft,
} from 'lucide-react';
import {
  aiEngine,
  seedAiEngineIfEmpty,
  subscribeProviders,
  subscribeMcpServers,
} from '@/lib/aiEngine';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'services', label: 'AI Services', icon: Bot },
  { id: 'mcp', label: 'MCP Servers', icon: Server },
  { id: 'siteservices', label: 'Site Services', icon: Layers },
  { id: 'playground', label: 'Playground', icon: FlaskConical },
  { id: 'usage', label: 'Usage & Cost', icon: BarChart2 },
];

function StatusBadge({ status }) {
  const map = {
    connected: { label: 'Connected', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
    error: { label: 'Error', cls: 'bg-red-100 text-red-700 border-red-200' },
    untested: { label: 'Untested', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
    unavailable: { label: 'No API yet', cls: 'bg-slate-100 text-slate-500 border-slate-200' },
  };
  const { label, cls } = map[status] || map.untested;
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${cls}`}>{label}</span>
  );
}

function ProviderIcon({ provider }) {
  const icons = {
    anthropic: '🟣',
    vertex: '🔵',
    perplexity: '🔍',
    azure: '🪟',
    bedrock: '🟠',
    notebooklm: '📓',
  };
  return (
    <span className="text-2xl leading-none">{provider?.icon || icons[provider?.id] || '🤖'}</span>
  );
}

function fmtCost(usd) {
  if (!usd || usd < 0.000001) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(6)}`;
  return `$${usd.toFixed(4)}`;
}
function fmtTokens(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
function timeAgo(ts) {
  if (!ts) return 'Never';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  const secs = Math.floor((Date.now() - d) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return d.toLocaleDateString();
}

function getServiceCardClassName(isGreyed, isChecked, checkedColor) {
  if (isGreyed) {
    return 'opacity-40 cursor-not-allowed bg-slate-50 border-slate-200 dark:bg-slate-800/30 dark:border-slate-700';
  }
  if (isChecked) {
    return `bg-${checkedColor}-50 border-${checkedColor}-200 dark:bg-${checkedColor}-900/20 dark:border-${checkedColor}-700 cursor-pointer`;
  }
  return 'bg-white border-slate-200 dark:bg-slate-900 dark:border-slate-700 hover:border-slate-300 cursor-pointer';
}

function getServiceSelectionIcon(isChecked, isGreyed, checkedColor) {
  if (isChecked && !isGreyed) {
    return <CheckSquare className={`h-4 w-4 text-${checkedColor}-500 shrink-0`} />;
  }
  return <Square className="h-4 w-4 text-slate-300 shrink-0" />;
}

// ─── Services Tab ─────────────────────────────────────────────────────────────

function ProviderCard({ provider, onToggle, onModelChange, onTest }) {
  const [testing, setTesting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();

  const handleTest = async () => {
    if (provider.status === 'unavailable') return;
    setTesting(true);
    await onTest(provider.id);
    setTesting(false);
  };

  const isUnavailable = provider.status === 'unavailable';

  return (
    <Card
      className={`transition-all ${provider.enabled ? 'ring-1 ring-indigo-400/40' : 'opacity-80'}`}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <ProviderIcon provider={provider} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm">{provider.name}</span>
              <StatusBadge status={provider.status} />
              {provider.latencyMs && provider.status === 'connected' && (
                <span className="text-xs text-slate-400">{provider.latencyMs}ms</span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">{provider.description}</p>

            {/* Model selector */}
            {!isUnavailable && provider.models?.length > 0 && (
              <div className="mt-2">
                <Select
                  value={provider.defaultModel || ''}
                  onValueChange={(val) => onModelChange(provider.id, val)}
                >
                  <SelectTrigger className="h-7 text-xs w-full max-w-xs">
                    <SelectValue placeholder="Select model" />
                  </SelectTrigger>
                  <SelectContent>
                    {provider.models.map((m) => (
                      <SelectItem key={m} value={m} className="text-xs">
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Last tested */}
            {provider.lastTested && (
              <p className="text-xs text-slate-400 mt-1">Tested {timeAgo(provider.lastTested)}</p>
            )}
          </div>

          <div className="flex flex-col items-end gap-2 shrink-0">
            <Switch
              checked={Boolean(provider.enabled)}
              onCheckedChange={(v) => onToggle(provider.id, v)}
              disabled={isUnavailable}
              aria-label={`Enable ${provider.name}`}
            />
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs px-2"
                onClick={handleTest}
                disabled={testing || isUnavailable || !provider.enabled}
              >
                {testing ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Play className="h-3 w-3 mr-1" />
                )}
                Test
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-slate-400 hover:text-indigo-600"
                onClick={() => navigate(`/admin/ai-engine/docs/${provider.id}`)}
                title="View setup instructions"
                aria-label={`View docs for ${provider.name}`}
              >
                <BookOpen className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>

        {/* Notes / expand */}
        {provider.notes && (
          <button
            className="flex items-center gap-1 text-xs text-slate-400 mt-2 hover:text-slate-600 transition-colors"
            onClick={() => setExpanded((p) => !p)}
          >
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Setup notes
          </button>
        )}
        {expanded && provider.notes && (
          <div className="mt-2 p-2 bg-slate-50 dark:bg-slate-800 rounded text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            {provider.notes}
            {provider.docsUrl && (
              <a
                href={provider.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 ml-2 text-indigo-600 hover:underline"
              >
                Docs <ExternalLink className="h-2.5 w-2.5" />
              </a>
            )}
          </div>
        )}

        {/* Error message */}
        {provider.lastError && provider.status === 'error' && (
          <div className="mt-2 p-2 bg-red-50 dark:bg-red-900/20 rounded text-xs text-red-600 dark:text-red-400">
            {provider.lastError}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Which parts of the site may call a model.
 *
 * The list of switches comes from the API, not from a constant here. A copy of
 * that list kept in the browser is exactly how this page came to advertise
 * providers the server had removed, and a switch that governs nothing is worse
 * than no switch at all — it reads as working.
 */
function FeatureSwitches() {
  const { toast } = useToast();
  const [features, setFeatures] = useState(null);
  const [catalogue, setCatalogue] = useState({});
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    aiEngine
      .getAiFeatures()
      .then(({ features: f, catalogue: c }) => {
        if (cancelled) return;
        setFeatures(f);
        setCatalogue(c);
      })
      .catch((err) => !cancelled && setError(err?.message || 'Could not load AI feature settings'));
    return () => {
      cancelled = true;
    };
  }, []);

  const handleToggle = async (name, next) => {
    setBusy(name);
    // Optimistic, then reconciled with what the server stored. A switch that
    // springs back is the honest outcome of a failed write.
    setFeatures((prev) => ({ ...prev, [name]: next }));
    try {
      const saved = await aiEngine.setAiFeature(name, next);
      setFeatures((prev) => ({ ...prev, ...saved }));
    } catch (err) {
      setFeatures((prev) => ({ ...prev, [name]: !next }));
      toast({
        title: 'Could not save',
        description: err?.message || 'The switch has been put back.',
        variant: 'destructive',
      });
    } finally {
      setBusy(null);
    }
  };

  if (error) {
    return (
      <Card>
        <CardContent className="py-4 text-sm text-red-600 dark:text-red-400">{error}</CardContent>
      </Card>
    );
  }

  const names = Object.keys(catalogue);
  const offCount = features ? names.filter((n) => features[n] === false).length : 0;

  let summary;
  if (features === null) {
    summary = 'Loading…';
  } else if (offCount === 0) {
    summary =
      'Every AI feature is on. Switching one off stops those calls immediately — the rest of the feature keeps working.';
  } else {
    summary = `${offCount} of ${names.length} switched off.`;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ToggleLeft className="h-4 w-4" />
          Where AI is used
        </CardTitle>
        <CardDescription>{summary}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1">
        {features === null ? (
          <div className="flex items-center gap-2 py-4 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Reading settings…
          </div>
        ) : (
          names.map((name) => (
            <div
              key={name}
              className="flex items-start justify-between gap-4 py-2.5 border-b last:border-b-0 border-slate-100 dark:border-slate-800"
            >
              <div className="min-w-0">
                <div className="font-medium text-sm">{catalogue[name]?.label || name}</div>
                <div className="text-xs text-slate-500 mt-0.5">{catalogue[name]?.description}</div>
                {/* The question someone actually has in front of a toggle. */}
                <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                  {catalogue[name]?.route}
                </div>
              </div>
              <Switch
                checked={features[name] !== false}
                disabled={busy === name}
                onCheckedChange={(next) => handleToggle(name, next)}
                aria-label={catalogue[name]?.label || name}
              />
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function ServicesTab({ providers }) {
  const { toast } = useToast();
  const [reordering, setReordering] = useState(false);

  const handleToggle = async (id, enabled) => {
    await aiEngine.setEnabled('ai_providers', id, enabled);
  };

  const handleModelChange = async (id, model) => {
    await aiEngine.setProviderModel(id, model);
  };

  const handleTest = async (id) => {
    const result = await aiEngine.testProvider(id);
    if (result.ok) {
      toast({ title: 'Connected ✓', description: `${result.latencyMs}ms response time` });
    } else {
      toast({ title: 'Connection failed', description: result.error, variant: 'destructive' });
    }
  };

  // The API tries providers in this order and uses the first one that is both
  // enabled and holds a key, so the sort here is the real running order.
  const ordered = [...providers].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));

  const move = async (index, delta) => {
    const next = [...ordered];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setReordering(true);
    try {
      await aiEngine.setProviderOrder(next.map((p) => p.id));
    } catch (err) {
      toast({
        title: 'Could not save the new order',
        description: err?.message || 'Nothing was changed.',
        variant: 'destructive',
      });
    } finally {
      setReordering(false);
    }
  };

  const enabledCount = ordered.filter((p) => p.enabled && p.status !== 'unavailable').length;
  const connectedCount = ordered.filter((p) => p.status === 'connected').length;
  // Which provider a request lands on right now. A key is required as well as
  // the switch, so an enabled provider with no key is not the answer.
  const active = ordered.find((p) => p.enabled && p.status !== 'unavailable');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-lg">AI Services</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {enabledCount} enabled · {connectedCount} verified · enable a provider then click Test
            to verify your API key
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Order of preference</CardTitle>
          <CardDescription>
            {active ? (
              <>
                Requests go to <span className="font-medium">{active.name}</span> first. If it has
                no API key, is switched off, or cannot serve the call, the next one down is used
                instead.
              </>
            ) : (
              'No provider is both enabled and holding an API key, so AI calls will fail.'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          {ordered.map((p, index) => (
            <div
              key={p.id}
              className="flex items-center gap-3 py-2 border-b last:border-b-0 border-slate-100 dark:border-slate-800"
            >
              <span className="w-5 text-sm text-slate-400 tabular-nums">{index + 1}</span>
              <span className="text-lg leading-none">{p.icon}</span>
              <span className="flex-1 text-sm font-medium truncate">{p.name}</span>
              {!p.enabled && <span className="text-xs text-slate-400">off</span>}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={index === 0 || reordering}
                onClick={() => move(index, -1)}
                aria-label={`Move ${p.name} up`}
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={index === ordered.length - 1 || reordering}
                onClick={() => move(index, 1)}
                aria-label={`Move ${p.name} down`}
              >
                <ArrowDown className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <FeatureSwitches />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {ordered.map((p) => (
          <ProviderCard
            key={p.id}
            provider={p}
            onToggle={handleToggle}
            onModelChange={handleModelChange}
            onTest={handleTest}
          />
        ))}
      </div>
    </div>
  );
}

// ─── MCP Servers Tab ──────────────────────────────────────────────────────────

function McpServerCard({ server, onToggle, onSync, onRemove }) {
  const [syncing, setSyncing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  const handleSync = async () => {
    setSyncing(true);
    const result = await onSync(server.id);
    setSyncing(false);
    if (result?.ok) {
      toast({ title: 'Tools synced', description: `${result.tools?.length || 0} tools found` });
    } else {
      toast({ title: 'Sync failed', description: result?.error, variant: 'destructive' });
    }
  };

  const isCustom = ![
    'plaud',
    'firecrawl',
    'context7',
    'replicate-mcp',
    'aws-knowledge-mcp',
    'microsoftdocs-mcp',
    'drawio-mcp',
    'hostinger-mcp',
  ].includes(server.id);

  return (
    <Card className={server.enabled ? 'ring-1 ring-emerald-400/40' : 'opacity-80'}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5">
            <Server className="h-5 w-5 text-slate-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm">{server.name}</span>
              <StatusBadge status={server.status} />
              {server.tools?.length > 0 && (
                <span className="text-xs text-slate-500">{server.tools.length} tools</span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5 truncate">{server.url}</p>
            {server.description && (
              <p className="text-xs text-slate-400 mt-0.5">{server.description}</p>
            )}
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            <Switch
              checked={Boolean(server.enabled)}
              onCheckedChange={(v) => onToggle(server.id, v)}
              aria-label={`Enable ${server.name}`}
            />
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs px-2"
                onClick={handleSync}
                disabled={syncing}
              >
                {syncing ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3 mr-1" />
                )}
                Sync Tools
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-slate-400 hover:text-indigo-600"
                onClick={() => navigate(`/admin/ai-engine/docs/${server.id}`)}
                title="View setup instructions"
                aria-label={`View docs for ${server.name}`}
              >
                <BookOpen className="h-3.5 w-3.5" />
              </Button>
              {isCustom && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 text-red-400 hover:text-red-600"
                  onClick={() => onRemove(server.id)}
                  title="Remove server"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Tool list */}
        {server.tools?.length > 0 && (
          <button
            className="flex items-center gap-1 text-xs text-slate-400 mt-2 hover:text-slate-600 transition-colors"
            onClick={() => setExpanded((p) => !p)}
          >
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {server.tools.length} tools available
          </button>
        )}
        {expanded && server.tools?.length > 0 && (
          <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
            {server.tools.map((t) => (
              <div key={t.name} className="px-2 py-1 bg-slate-50 dark:bg-slate-800 rounded text-xs">
                <span className="font-mono font-medium text-indigo-600 dark:text-indigo-400">
                  {t.name}
                </span>
                {t.description && <span className="text-slate-500 ml-2">{t.description}</span>}
              </div>
            ))}
          </div>
        )}

        {server.notes && <p className="text-xs text-slate-400 mt-2 italic">{server.notes}</p>}
        {server.lastError && server.status === 'error' && (
          <div className="mt-2 p-2 bg-red-50 rounded text-xs text-red-600">{server.lastError}</div>
        )}
      </CardContent>
    </Card>
  );
}

function AddServerForm({ onAdd }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', url: '', apiKeyEnvVar: '', description: '' });
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name || !form.url) return;
    setSaving(true);
    try {
      await onAdd({ ...form, transport: 'http', enabled: false, order: 99 });
      setForm({ name: '', url: '', apiKeyEnvVar: '', description: '' });
      setOpen(false);
      toast({ title: 'Server added', description: 'Click Sync Tools to fetch its tool list.' });
    } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {!open ? (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4 mr-2" /> Add MCP Server
        </Button>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Add Custom MCP Server</CardTitle>
            <CardDescription className="text-xs">
              Any MCP-compatible server using Streamable HTTP transport.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Name *</Label>
                  <Input
                    className="h-8 text-xs mt-1"
                    placeholder="My Search Server"
                    value={form.name}
                    onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <Label className="text-xs">Server URL *</Label>
                  <Input
                    className="h-8 text-xs mt-1"
                    placeholder="https://my-mcp.example.com/mcp"
                    value={form.url}
                    onChange={(e) => setForm((p) => ({ ...p, url: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <Label className="text-xs">API Key Env Var</Label>
                  <Input
                    className="h-8 text-xs mt-1"
                    placeholder="MY_SERVER_API_KEY"
                    value={form.apiKeyEnvVar}
                    onChange={(e) => setForm((p) => ({ ...p, apiKeyEnvVar: e.target.value }))}
                  />
                </div>
                <div>
                  <Label className="text-xs">Description</Label>
                  <Input
                    className="h-8 text-xs mt-1"
                    placeholder="Optional description"
                    value={form.description}
                    onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={saving}>
                  {saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />} Save
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function McpTab({ servers }) {
  const { toast } = useToast();

  const handleToggle = async (id, enabled) => {
    try {
      await aiEngine.setEnabled('mcp_servers', id, enabled);
      toast({ title: enabled ? 'Server enabled' : 'Server disabled' });
    } catch (err) {
      toast({
        title: 'Unable to update server',
        description: err.message,
        variant: 'destructive',
      });
    }
  };

  const handleSync = async (id) => {
    try {
      return await aiEngine.syncMcpTools(id);
    } catch (err) {
      toast({ title: 'Sync failed', description: err.message, variant: 'destructive' });
      return { ok: false, error: err.message };
    }
  };

  const handleRemove = async (id) => {
    if (!window.confirm('Remove this MCP server?')) return;
    try {
      await aiEngine.removeMcpServer(id);
      toast({ title: 'Server removed' });
    } catch (err) {
      toast({
        title: 'Unable to remove server',
        description: err.message,
        variant: 'destructive',
      });
    }
  };
  const handleAdd = (data) => aiEngine.addMcpServer(data);

  const enabledCount = servers.filter((s) => s.enabled).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-lg">MCP Servers</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {enabledCount} enabled — all tool calls proxy through the Azure Functions API so
            credentials never reach the browser
          </p>
        </div>
      </div>

      <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg text-xs text-blue-700 dark:text-blue-300 flex gap-2">
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
        <div>
          <strong>Transport:</strong> MCP requests go through the{' '}
          <strong>Azure Functions API</strong>. Each server uses its configured transport
          (Streamable HTTP or SSE). API keys come from Azure Function App settings / Key Vault
          references, and OAuth tokens are stored in Cosmos DB — never exposed to the browser.
          Click <em>Sync Tools</em> to fetch the tool list server-side.
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {servers.map((s) => (
          <McpServerCard
            key={s.id}
            server={s}
            onToggle={handleToggle}
            onSync={handleSync}
            onRemove={handleRemove}
          />
        ))}
      </div>

      <AddServerForm onAdd={handleAdd} />
    </div>
  );
}

// ─── Playground Tab ───────────────────────────────────────────────────────────

function PlaygroundTab({ providers, servers }) {
  const [mode, setMode] = useState('ai'); // 'ai' | 'mcp'
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [server, setServer] = useState('');
  const [tool, setTool] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [userPrompt, setUserPrompt] = useState('');
  const [toolArgs, setToolArgs] = useState('{}');
  const [sending, setSending] = useState(false);
  const [response, setResponse] = useState(null);
  const [history, setHistory] = useState([]);
  const { toast } = useToast();

  const enabledProviders = providers.filter((p) => p.enabled && p.status !== 'unavailable');
  const enabledServers = servers.filter((s) => s.enabled && s.tools?.length > 0);

  const selectedProvider = providers.find((p) => p.id === provider);
  const selectedServer = servers.find((s) => s.id === server);

  const handleSend = async () => {
    if (mode === 'ai' && (!provider || !userPrompt)) {
      toast({ title: 'Pick a provider and write a prompt', variant: 'destructive' });
      return;
    }
    if (mode === 'mcp' && (!server || !tool)) {
      toast({ title: 'Pick a server and tool', variant: 'destructive' });
      return;
    }

    setSending(true);
    setResponse(null);
    const t0 = Date.now();

    try {
      let result;
      if (mode === 'ai') {
        result = await aiEngine.chat(provider, model, userPrompt, systemPrompt, 'admin_playground');
        const entry = {
          id: Date.now(),
          mode,
          provider,
          model,
          prompt: userPrompt,
          text: result.text,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          estimatedCostUsd: result.estimatedCostUsd,
          latencyMs: result.latencyMs || Date.now() - t0,
        };
        setResponse(entry);
        setHistory((h) => [entry, ...h.slice(0, 9)]);
      } else {
        let args = {};
        try {
          args = JSON.parse(toolArgs);
        } catch {
          /* ignore */
        }
        result = await aiEngine.mcpTool(server, tool, args);
        const entry = {
          id: Date.now(),
          mode,
          server,
          tool,
          text: result.result || JSON.stringify(result),
          latencyMs: Date.now() - t0,
        };
        setResponse(entry);
        setHistory((h) => [entry, ...h.slice(0, 9)]);
      }
    } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-semibold text-lg">Playground</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Test any AI provider or MCP tool directly from here.
        </p>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-2">
        {[
          { id: 'ai', label: '🤖 AI Provider' },
          { id: 'mcp', label: '🔧 MCP Tool' },
        ].map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              mode === m.id
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Input panel */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{mode === 'ai' ? 'Prompt' : 'Tool Call'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {mode === 'ai' ? (
              <>
                {enabledProviders.length === 0 ? (
                  <p className="text-xs text-amber-600 bg-amber-50 p-2 rounded">
                    Enable and test at least one AI provider first.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Provider</Label>
                      <Select
                        value={provider}
                        onValueChange={(nextProvider) => {
                          setProvider(nextProvider);
                          const next = providers.find((p) => p.id === nextProvider);
                          setModel(next?.defaultModel || '');
                        }}
                      >
                        <SelectTrigger className="h-8 text-xs mt-1">
                          <SelectValue placeholder="Pick provider" />
                        </SelectTrigger>
                        <SelectContent>
                          {enabledProviders.map((p) => (
                            <SelectItem key={p.id} value={p.id} className="text-xs">
                              {p.icon} {p.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Model</Label>
                      <Select value={model} onValueChange={setModel}>
                        <SelectTrigger className="h-8 text-xs mt-1">
                          <SelectValue placeholder="Model" />
                        </SelectTrigger>
                        <SelectContent>
                          {(selectedProvider?.models || []).map((m) => (
                            <SelectItem key={m} value={m} className="text-xs">
                              {m}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                <div>
                  <Label className="text-xs">System Prompt (optional)</Label>
                  <Textarea
                    className="text-xs mt-1 resize-none"
                    rows={2}
                    placeholder="You are a helpful assistant..."
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                  />
                </div>
                <div>
                  <Label className="text-xs">User Message *</Label>
                  <Textarea
                    className="text-xs mt-1 resize-none"
                    rows={4}
                    placeholder="What would you like to ask?"
                    value={userPrompt}
                    onChange={(e) => setUserPrompt(e.target.value)}
                  />
                </div>
              </>
            ) : (
              <>
                {enabledServers.length === 0 ? (
                  <p className="text-xs text-amber-600 bg-amber-50 p-2 rounded">
                    Enable a server and sync its tools first.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Server</Label>
                      <Select
                        value={server}
                        onValueChange={(nextServer) => {
                          setServer(nextServer);
                          const next = servers.find((s) => s.id === nextServer);
                          setTool(next?.tools?.[0]?.name || '');
                        }}
                      >
                        <SelectTrigger className="h-8 text-xs mt-1">
                          <SelectValue placeholder="Pick server" />
                        </SelectTrigger>
                        <SelectContent>
                          {enabledServers.map((s) => (
                            <SelectItem key={s.id} value={s.id} className="text-xs">
                              {s.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Tool</Label>
                      <Select value={tool} onValueChange={setTool}>
                        <SelectTrigger className="h-8 text-xs mt-1">
                          <SelectValue placeholder="Tool" />
                        </SelectTrigger>
                        <SelectContent>
                          {(selectedServer?.tools || []).map((t) => (
                            <SelectItem key={t.name} value={t.name} className="text-xs font-mono">
                              {t.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
                <div>
                  <Label className="text-xs">Arguments (JSON)</Label>
                  <Textarea
                    className="text-xs mt-1 font-mono resize-none"
                    rows={4}
                    placeholder='{"query": "latest cloud news"}'
                    value={toolArgs}
                    onChange={(e) => setToolArgs(e.target.value)}
                  />
                </div>
              </>
            )}

            <Button className="w-full" onClick={handleSend} disabled={sending}>
              {sending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Send
            </Button>
          </CardContent>
        </Card>

        {/* Response panel */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center justify-between">
              <span>Response</span>
              {response && (
                <span className="flex gap-2 text-xs font-normal text-slate-500">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {response.latencyMs}ms
                  </span>
                  {response.estimatedCostUsd !== undefined && (
                    <span className="flex items-center gap-1">
                      <DollarSign className="h-3 w-3" />
                      {fmtCost(response.estimatedCostUsd)}
                    </span>
                  )}
                  {response.promptTokens > 0 && (
                    <span>
                      {fmtTokens(response.promptTokens + response.completionTokens)} tokens
                    </span>
                  )}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {sending && (
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" /> Waiting for response…
              </div>
            )}
            {!sending && !response && (
              <p className="text-xs text-slate-400 italic">Response will appear here.</p>
            )}
            {!sending && response && (
              <div className="text-xs whitespace-pre-wrap leading-relaxed max-h-80 overflow-y-auto font-mono bg-slate-50 dark:bg-slate-900 p-3 rounded border">
                {response.text}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* History */}
      {history.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-2">Recent calls this session</h3>
          <div className="space-y-1">
            {history.map((h) => (
              <button
                key={h.id}
                className="w-full text-left px-3 py-2 bg-slate-50 dark:bg-slate-800 rounded text-xs hover:bg-slate-100 transition-colors"
                onClick={() => setResponse(h)}
              >
                <span className="font-medium">
                  {h.provider || h.server}/{h.model || h.tool}
                </span>
                <span className="text-slate-400 ml-2 truncate inline-block max-w-xs">
                  {(h.prompt || h.tool || '').slice(0, 60)}
                </span>
                <span className="text-slate-400 ml-auto float-right">{h.latencyMs}ms</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Site Services Tab ────────────────────────────────────────────────────────

/**
 * SITE_PAGES — list of pages that use AI or MCP services.
 * Each entry: { id, label, path, description, services: string[] }
 * services must be IDs matching the SERVICES map below.
 */
const SITE_PAGES = [
  {
    id: 'content-pipeline',
    label: 'ContentForge Pipeline',
    path: '/admin/submit-urls',
    description: 'Ingest URLs → AI analysis, content generation, cover image creation',
    services: ['vertex', 'anthropic', 'perplexity', 'replicate', 'firecrawl'],
  },
  {
    id: 'recordings',
    label: 'Recordings',
    path: '/admin/recordings',
    description: 'Plaud MCP integration — browse recordings, transcripts, AI notes',
    services: ['plaud', 'anthropic', 'vertex'],
  },
  {
    id: 'ai-playground',
    label: 'AI Playground',
    path: '/admin/ai-engine (Playground tab)',
    description: 'Interactive chat with any enabled AI provider or MCP tool',
    services: [
      'anthropic',
      'vertex',
      'perplexity',
      'azure',
      'bedrock',
      'replicate',
      'firecrawl',
      'context7',
      'plaud',
    ],
  },
  {
    id: 'submit-urls',
    label: 'Submit URLs',
    path: '/admin/submit-urls',
    description: 'Firecrawl-powered URL scraping and content ingestion',
    services: ['firecrawl', 'vertex', 'anthropic'],
  },
  {
    id: 'dashboard',
    label: 'Admin Dashboard',
    path: '/admin/dashboard',
    description: 'ContentForge pipeline status, Plaud → content workflow',
    services: ['plaud', 'firecrawl'],
  },
];

/**
 * SERVICES — all available AI / MCP services and their mutual-exclusivity groups.
 * exclusiveWith: services in the same group cannot be active at the same time.
 */
const SERVICES = {
  // AI providers
  anthropic: { label: 'Claude (Anthropic)', icon: '🟣', type: 'ai', exclusiveWith: [] },
  vertex: { label: 'Gemini (Vertex AI)', icon: '🔵', type: 'ai', exclusiveWith: [] },
  perplexity: { label: 'Perplexity Sonar', icon: '🔍', type: 'ai', exclusiveWith: [] },
  azure: { label: 'Azure OpenAI', icon: '🪟', type: 'ai', exclusiveWith: [] },
  bedrock: { label: 'AWS Bedrock (Nova)', icon: '🟠', type: 'ai', exclusiveWith: [] },
  replicate: { label: 'Replicate', icon: '🎨', type: 'ai', exclusiveWith: [] },
  // MCP servers
  plaud: { label: 'Plaud MCP', icon: '🎙️', type: 'mcp', exclusiveWith: [] },
  firecrawl: { label: 'Firecrawl MCP', icon: '🔥', type: 'mcp', exclusiveWith: [] },
  context7: { label: 'Context7 MCP', icon: '📚', type: 'mcp', exclusiveWith: [] },
  'replicate-mcp': {
    label: 'Replicate MCP',
    icon: '🎨',
    type: 'mcp',
    exclusiveWith: ['replicate'],
  },
};

function SiteServicesTab() {
  const [selectedPage, setSelectedPage] = useState(SITE_PAGES[0].id);
  const [prevPage, setPrevPage] = useState(selectedPage);
  const [checked, setChecked] = useState(() => {
    const init = {};
    (SITE_PAGES[0]?.services ?? []).forEach((s) => {
      init[s] = true;
    });
    return init;
  });

  const page = SITE_PAGES.find((p) => p.id === selectedPage);
  const pageServices = page ? page.services : [];

  // Reset checked state when page changes (setState-during-render pattern)
  if (prevPage !== selectedPage) {
    setPrevPage(selectedPage);
    const init = {};
    pageServices.forEach((s) => {
      init[s] = true;
    });
    setChecked(init);
  }

  /** Returns set of service IDs that are greyed out due to mutual exclusivity */
  function getGreyedOut() {
    const greyed = new Set();
    pageServices.forEach((svcId) => {
      if (!checked[svcId]) return;
      const def = SERVICES[svcId];
      if (!def) return;
      def.exclusiveWith.forEach((excl) => {
        if (pageServices.includes(excl) && excl !== svcId) greyed.add(excl);
      });
    });
    return greyed;
  }

  const greyedOut = getGreyedOut();

  function toggleService(svcId) {
    if (greyedOut.has(svcId)) return; // disabled by exclusivity
    setChecked((prev) => ({ ...prev, [svcId]: !prev[svcId] }));
  }

  function setAll(value) {
    const next = {};
    pageServices.forEach((s) => {
      next[s] = value;
    });
    setChecked(next);
  }

  const aiServices = pageServices.filter((s) => SERVICES[s]?.type === 'ai');
  const mcpServices = pageServices.filter((s) => SERVICES[s]?.type === 'mcp');
  const checkedCount = pageServices.filter((s) => checked[s]).length;

  return (
    <div className="space-y-6">
      {/* Page selector */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Select a Page</CardTitle>
          <CardDescription className="text-xs">
            Choose a site page to view and configure which AI / MCP services it uses.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={selectedPage} onValueChange={setSelectedPage}>
            <SelectTrigger className="w-full max-w-md">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SITE_PAGES.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {page && (
            <p className="mt-2 text-xs text-slate-500">
              <span className="font-mono text-slate-400">{page.path}</span> — {page.description}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Service matrix */}
      {page && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm">{page.label} — Service Matrix</CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  {checkedCount} of {pageServices.length} services enabled for this page. Services
                  greyed out are mutually exclusive with an active selection.
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => setAll(true)}
                >
                  All
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => setAll(false)}
                >
                  None
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {aiServices.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                  AI Providers
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {aiServices.map((svcId) => {
                    const def = SERVICES[svcId] || { label: svcId, icon: '🔲', exclusiveWith: [] };
                    const isGreyed = greyedOut.has(svcId);
                    const isChecked = Boolean(checked[svcId]);
                    const checkedColor = 'indigo';
                    return (
                      <button
                        key={svcId}
                        onClick={() => toggleService(svcId)}
                        disabled={isGreyed}
                        className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${getServiceCardClassName(
                          isGreyed,
                          isChecked,
                          checkedColor
                        )}`}
                      >
                        {getServiceSelectionIcon(isChecked, isGreyed, checkedColor)}
                        <span className="text-base leading-none">{def.icon}</span>
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate">{def.label}</p>
                          {isGreyed && (
                            <p className="text-xs text-slate-400">
                              Mutually exclusive — deselect conflicting service first
                            </p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {mcpServices.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                  MCP Servers
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {mcpServices.map((svcId) => {
                    const def = SERVICES[svcId] || { label: svcId, icon: '🔲', exclusiveWith: [] };
                    const isGreyed = greyedOut.has(svcId);
                    const isChecked = Boolean(checked[svcId]);
                    const checkedColor = 'emerald';
                    return (
                      <button
                        key={svcId}
                        onClick={() => toggleService(svcId)}
                        disabled={isGreyed}
                        className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${getServiceCardClassName(
                          isGreyed,
                          isChecked,
                          checkedColor
                        )}`}
                      >
                        {getServiceSelectionIcon(isChecked, isGreyed, checkedColor)}
                        <span className="text-base leading-none">{def.icon}</span>
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate">{def.label}</p>
                          {isGreyed && <p className="text-xs text-slate-400">Mutually exclusive</p>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

const UsageTab = lazy(() => import('@/pages/admin/AIEngineUsageTab'));

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AIEnginePage() {
  const [activeTab, setActiveTab] = useState('services');
  const [providers, setProviders] = useState([]);
  const [servers, setServers] = useState([]);
  const [seeded, setSeeded] = useState(false);

  // Seed and subscribe on mount
  useEffect(() => {
    seedAiEngineIfEmpty().then(() => setSeeded(true));
  }, []);

  useEffect(() => {
    if (!seeded) return;
    const unsubP = subscribeProviders(setProviders);
    const unsubS = subscribeMcpServers(setServers);
    return () => {
      unsubP();
      unsubS();
    };
  }, [seeded]);

  const enabledCount = providers.filter((p) => p.enabled && p.status !== 'unavailable').length;
  const mcpCount = servers.filter((s) => s.enabled).length;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-900/40">
          <Bot className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold">AI Engine</h1>
          <p className="text-sm text-slate-500">
            {enabledCount} AI provider{enabledCount !== 1 ? 's' : ''} · {mcpCount} MCP server
            {mcpCount !== 1 ? 's' : ''} active
          </p>
        </div>
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-700">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === id
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {!seeded ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      ) : (
        <>
          {activeTab === 'services' && <ServicesTab providers={providers} />}
          {activeTab === 'mcp' && <McpTab servers={servers} />}
          {activeTab === 'siteservices' && <SiteServicesTab />}
          {activeTab === 'playground' && <PlaygroundTab providers={providers} servers={servers} />}
          {activeTab === 'usage' && (
            <Suspense
              fallback={
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                </div>
              }
            >
              <UsageTab />
            </Suspense>
          )}
        </>
      )}
    </div>
  );
}
