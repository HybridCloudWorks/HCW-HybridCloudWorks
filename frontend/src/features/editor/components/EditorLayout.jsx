import { lazy, Suspense } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileText, Puzzle, Settings, LayoutDashboard } from 'lucide-react';
import { SaveBar } from './SaveBar';
import { ContentTab } from './ContentTab';
import { ModulesTab } from './ModulesTab';
import { MetadataTab } from './MetadataTab';
import { BoardTab } from './BoardTab';
import { useEditor } from '../context/EditorContext';

// Lazy-load the preview panel — ReactMarkdown + InlineModules are heavy and
// only needed once the editor is open and visible on lg+ screens.
const PreviewPanel = lazy(() =>
  import('./PreviewPanel').then((m) => ({ default: m.PreviewPanel }))
);

export function EditorLayout({ navigate }) {
  const { loading, loadError, activeTab, setActiveTab } = useEditor();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center space-y-2 max-w-md px-4">
          <p className="text-destructive font-medium">Failed to load document</p>
          <p className="text-sm text-muted-foreground">{loadError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      {/* Sticky top bar */}
      <SaveBar navigate={navigate} />

      {/* Two-column body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: tabbed editor panel */}
        <div className="flex-1 overflow-y-auto">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
            <div className="sticky top-0 z-10 bg-background border-b border-border px-4 pt-3 pb-0">
              <TabsList className="w-full justify-start h-9 bg-transparent p-0 gap-1">
                <TabsTrigger
                  value="content"
                  className="h-8 px-3 text-xs data-[state=active]:bg-muted data-[state=active]:shadow-none rounded-md"
                >
                  <FileText className="h-3.5 w-3.5 mr-1.5" />
                  Content
                </TabsTrigger>
                <TabsTrigger
                  value="modules"
                  className="h-8 px-3 text-xs data-[state=active]:bg-muted data-[state=active]:shadow-none rounded-md"
                >
                  <Puzzle className="h-3.5 w-3.5 mr-1.5" />
                  Modules
                </TabsTrigger>
                <TabsTrigger
                  value="metadata"
                  className="h-8 px-3 text-xs data-[state=active]:bg-muted data-[state=active]:shadow-none rounded-md"
                >
                  <Settings className="h-3.5 w-3.5 mr-1.5" />
                  Metadata
                </TabsTrigger>
                <TabsTrigger
                  value="board"
                  className="h-8 px-3 text-xs data-[state=active]:bg-muted data-[state=active]:shadow-none rounded-md"
                >
                  <LayoutDashboard className="h-3.5 w-3.5 mr-1.5" />
                  Board
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="content" className="flex-1 p-4 mt-0">
              <ContentTab />
            </TabsContent>
            <TabsContent value="modules" className="flex-1 p-4 mt-0">
              <ModulesTab />
            </TabsContent>
            <TabsContent value="metadata" className="flex-1 p-4 mt-0">
              <MetadataTab />
            </TabsContent>
            <TabsContent value="board" className="flex-1 p-4 mt-0">
              <BoardTab />
            </TabsContent>
          </Tabs>
        </div>

        {/* Right: persistent preview panel (lazy-loaded) */}
        <div className="hidden lg:flex w-80 xl:w-96 border-l border-border flex-col overflow-hidden">
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
                Loading preview…
              </div>
            }
          >
            <PreviewPanel />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
