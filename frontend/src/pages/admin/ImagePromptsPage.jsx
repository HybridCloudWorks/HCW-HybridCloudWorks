import React, { useCallback, useEffect, useState } from 'react';
import ConfirmModal from '@/components/admin/ConfirmModal';
import { useImagePrompts } from '@/hooks/useImagePrompts';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Check, X } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import KeywordMatrixPanel from '@/components/admin/KeywordMatrixPanel';

const SLOT_TEMPLATE_FIELDS = [
  {
    key: 'hero',
    label: 'Hero Slot Template',
    placeholder: 'Cover composition guidance for the hero image.',
  },
  {
    key: 'secondary1',
    label: 'Secondary 1 Slot Template',
    placeholder: 'Architecture or platform detail emphasis for supporting image 1.',
  },
  {
    key: 'secondary2',
    label: 'Secondary 2 Slot Template',
    placeholder: 'Implementation flow or operational motion emphasis for supporting image 2.',
  },
  {
    key: 'secondary3',
    label: 'Secondary 3 Slot Template',
    placeholder: 'Business outcome or governance emphasis for supporting image 3.',
  },
];

const EMPTY_SLOT_TEMPLATES = {
  hero: '',
  secondary1: '',
  secondary2: '',
  secondary3: '',
};

const PAGE_GROUPS = [
  {
    provider: 'AWS',
    pages: [
      ['', 'Landing'],
      ['/news', 'News'],
      ['/blog', 'Blog'],
      ['/architecture-designs', 'Architecture Designs'],
      ['/frameworks', 'Frameworks'],
      ['/education', 'Education'],
      ['/audio-architecture', 'Audio Architecture'],
    ],
  },
  {
    provider: 'Azure',
    pages: [
      ['', 'Landing'],
      ['/news', 'News'],
      ['/blog', 'Blog'],
      ['/architecture-designs', 'Architecture Designs'],
      ['/frameworks', 'Frameworks'],
      ['/education', 'Education'],
      ['/audio-architecture', 'Audio Architecture'],
    ],
  },
  {
    provider: 'GCP',
    pages: [
      ['', 'Landing'],
      ['/news', 'News'],
      ['/blog', 'Blog'],
      ['/architecture-designs', 'Architecture Designs'],
      ['/frameworks', 'Frameworks'],
      ['/education', 'Education'],
      ['/audio-architecture', 'Audio Architecture'],
    ],
  },
  {
    provider: 'FinOps',
    pages: [
      ['', 'Landing'],
      ['/news', 'News'],
      ['/blog', 'Blog'],
      ['/architecture-designs', 'Architecture Designs'],
      ['/frameworks', 'Frameworks'],
      ['/education', 'Education'],
      ['/tools', 'Tools'],
      ['/focus', 'Focus'],
    ],
  },
  {
    provider: 'Terraform',
    pages: [
      ['', 'Landing'],
      ['/news', 'News'],
      ['/blog', 'Blog'],
      ['/code', 'Code'],
      ['/modules', 'Modules'],
      ['/tools', 'Tools'],
    ],
  },
  {
    provider: 'GitHub',
    pages: [
      ['', 'Landing'],
      ['/news', 'News'],
      ['/blog', 'Blog'],
      ['/workflows', 'Workflows'],
      ['/code', 'Code'],
      ['/tools', 'Tools'],
    ],
  },
];

const PAGES = PAGE_GROUPS.flatMap(({ provider, pages }) =>
  pages.map(([suffix, label]) => {
    const basePath = `/${provider.toLowerCase()}`;
    const value = suffix ? `${basePath}${suffix}` : basePath;
    return {
      value,
      label: `${provider} ${label}`,
    };
  })
);

function normalizeValue(value) {
  return String(value || '').trim();
}

export default function ImagePromptsPage() {
  const { toast } = useToast();
  const {
    fetchPromptSets,
    fetchPromptSet,
    savePromptSet,
    deletePromptSet,
    fetchPromptNames,
    fetchPrompt,
    savePrompt,
    deletePrompt,
    fetchPageAssignment,
    savePageAssignment,
    error: hookError,
  } = useImagePrompts();

  const [selectedPage, setSelectedPage] = useState(PAGES[0].value);
  const [promptSets, setPromptSets] = useState([]);
  const [selectedPromptSet, setSelectedPromptSet] = useState('');
  const [promptSetName, setPromptSetName] = useState('');
  const [promptNames, setPromptNames] = useState([]);
  const [selectedPromptName, setSelectedPromptName] = useState('');
  const [promptName, setPromptName] = useState('');
  const [primaryPrompt, setPrimaryPrompt] = useState('');
  const [additionalParameters, setAdditionalParameters] = useState('');
  const [slotTemplates, setSlotTemplates] = useState(EMPTY_SLOT_TEMPLATES);
  const [isLoading, setIsLoading] = useState(false);
  const [pageStatus, setPageStatus] = useState('');
  const [deletePromptSetOpen, setDeletePromptSetOpen] = useState(false);
  const [deletePromptOpen, setDeletePromptOpen] = useState(false);

  const resetPromptFields = useCallback(() => {
    setPromptNames([]);
    setSelectedPromptName('');
    setPromptName('');
    setAdditionalParameters('');
    setSlotTemplates(EMPTY_SLOT_TEMPLATES);
  }, []);

  const resetSetFields = useCallback(() => {
    setSelectedPromptSet('');
    setPromptSetName('');
    setPrimaryPrompt('');
    resetPromptFields();
  }, [resetPromptFields]);

  const loadPromptDetails = useCallback(
    async (setName, nextPromptName) => {
      if (!setName || !nextPromptName) {
        setSelectedPromptName('');
        setPromptName('');
        setAdditionalParameters('');
        return;
      }

      const promptData = await fetchPrompt(setName, nextPromptName);
      setSelectedPromptName(nextPromptName);
      setPromptName(nextPromptName);
      setAdditionalParameters(promptData?.additionalParameters || '');
      setSlotTemplates({ ...EMPTY_SLOT_TEMPLATES, ...(promptData?.slotTemplates || {}) });
    },
    [fetchPrompt]
  );

  const loadPromptSetDetails = useCallback(
    async (setName, preferredPromptName = '') => {
      if (!setName) {
        resetSetFields();
        return;
      }

      const [setData, names] = await Promise.all([
        fetchPromptSet(setName),
        fetchPromptNames(setName),
      ]);
      setSelectedPromptSet(setName);
      setPromptSetName(setName);
      setPrimaryPrompt(setData?.primaryPrompt || '');
      setPromptNames(names);

      const nextPromptName = names.includes(preferredPromptName) ? preferredPromptName : '';
      await loadPromptDetails(setName, nextPromptName);
    },
    [fetchPromptNames, fetchPromptSet, loadPromptDetails, resetSetFields]
  );

  const loadPageState = useCallback(
    async (pagePath) => {
      setIsLoading(true);
      setPageStatus('');
      try {
        const [allPromptSets, assignment] = await Promise.all([
          fetchPromptSets(),
          fetchPageAssignment(pagePath),
        ]);

        setPromptSets(allPromptSets);

        const assignedSetName = normalizeValue(assignment?.setName);
        const assignedPromptName = normalizeValue(assignment?.promptName);

        if (assignedSetName) {
          await loadPromptSetDetails(assignedSetName, assignedPromptName);
          setPageStatus(
            assignedPromptName
              ? `Assigned: ${assignedSetName} / ${assignedPromptName}`
              : `Assigned: ${assignedSetName}`
          );
        } else {
          resetSetFields();
          setPageStatus('No Prompt Set assigned to this page yet.');
        }
      } finally {
        setIsLoading(false);
      }
    },
    [fetchPageAssignment, fetchPromptSets, loadPromptSetDetails, resetSetFields]
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      loadPageState(selectedPage);
    }, 0);
    return () => clearTimeout(timer);
  }, [loadPageState, selectedPage]);

  const handleSelectPromptSet = async (setName) => {
    setIsLoading(true);
    try {
      if (!setName) {
        resetSetFields();
        await savePageAssignment(selectedPage, '', '');
        setPageStatus('No Prompt Set assigned to this page yet.');
        return;
      }

      await loadPromptSetDetails(setName);
      await savePageAssignment(selectedPage, setName, '');
      setPageStatus(`Assigned Prompt Set "${setName}" to ${selectedPage}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectPromptName = async (nextPromptName) => {
    setIsLoading(true);
    try {
      await loadPromptDetails(selectedPromptSet || promptSetName, nextPromptName);
      await savePageAssignment(selectedPage, selectedPromptSet || promptSetName, nextPromptName);
      setPageStatus(
        nextPromptName
          ? `Assigned: ${(selectedPromptSet || promptSetName).trim()} / ${nextPromptName}`
          : `Assigned: ${(selectedPromptSet || promptSetName).trim()}`
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleSavePromptSet = async () => {
    const nextSetName = normalizeValue(promptSetName);
    if (!nextSetName) {
      toast({
        title: 'Validation Error',
        description: 'Prompt Set name cannot be empty.',
        variant: 'destructive',
      });
      return;
    }

    if (!primaryPrompt.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Primary Prompt cannot be empty.',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    try {
      const success = await savePromptSet(nextSetName, primaryPrompt);
      if (!success) {
        throw new Error(hookError || 'Failed to save Prompt Set.');
      }

      const allPromptSets = await fetchPromptSets();
      setPromptSets(allPromptSets);
      setSelectedPromptSet(nextSetName);
      await savePageAssignment(selectedPage, nextSetName, selectedPromptName || promptName);
      setPageStatus(
        selectedPromptName || promptName
          ? `Assigned: ${nextSetName} / ${selectedPromptName || promptName}`
          : `Assigned: ${nextSetName}`
      );

      toast({
        title: 'Prompt Set Saved',
        description: `"${nextSetName}" is available to every page.`,
      });
    } catch (err) {
      toast({
        title: 'Error',
        description: err.message || 'Failed to save Prompt Set.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSavePrompt = async () => {
    const nextSetName = normalizeValue(promptSetName || selectedPromptSet);
    const nextPromptName = normalizeValue(promptName);

    if (!nextSetName) {
      toast({
        title: 'Validation Error',
        description: 'Select or create a Prompt Set first.',
        variant: 'destructive',
      });
      return;
    }

    if (!primaryPrompt.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Save the Prompt Set primary prompt before saving a Prompt Name.',
        variant: 'destructive',
      });
      return;
    }

    if (!nextPromptName) {
      toast({
        title: 'Validation Error',
        description: 'Prompt Name cannot be empty.',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    try {
      const setSaved = await savePromptSet(nextSetName, primaryPrompt);
      if (!setSaved) {
        throw new Error(hookError || 'Failed to save Prompt Set before saving Prompt Name.');
      }

      const promptSaved = await savePrompt(
        nextSetName,
        nextPromptName,
        additionalParameters,
        slotTemplates
      );
      if (!promptSaved) {
        throw new Error(hookError || 'Failed to save Prompt Name.');
      }

      const [allPromptSets, allPromptNames] = await Promise.all([
        fetchPromptSets(),
        fetchPromptNames(nextSetName),
      ]);
      setPromptSets(allPromptSets);
      setPromptNames(allPromptNames);
      setSelectedPromptSet(nextSetName);
      setPromptSetName(nextSetName);
      setSelectedPromptName(nextPromptName);
      setPromptName(nextPromptName);
      await savePageAssignment(selectedPage, nextSetName, nextPromptName);
      setPageStatus(`Assigned: ${nextSetName} / ${nextPromptName}`);

      toast({
        title: 'Prompt Name Saved',
        description: `"${nextPromptName}" is now available under "${nextSetName}".`,
      });
    } catch (err) {
      toast({
        title: 'Error',
        description: err.message || 'Failed to save Prompt Name.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const doDeletePromptSet = async () => {
    setDeletePromptSetOpen(false);
    const nextSetName = normalizeValue(selectedPromptSet || promptSetName);
    if (!nextSetName) return;

    setIsLoading(true);
    try {
      const success = await deletePromptSet(nextSetName);
      if (!success) {
        throw new Error(hookError || 'Failed to delete Prompt Set.');
      }

      const allPromptSets = await fetchPromptSets();
      setPromptSets(allPromptSets);
      resetSetFields();
      await savePageAssignment(selectedPage, '', '');
      setPageStatus('No Prompt Set assigned to this page yet.');

      toast({
        title: 'Prompt Set Deleted',
        description: `"${nextSetName}" and its Prompt Names were deleted.`,
      });
    } catch (err) {
      toast({
        title: 'Error',
        description: err.message || 'Failed to delete Prompt Set.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const doDeletePrompt = async () => {
    setDeletePromptOpen(false);
    const nextSetName = normalizeValue(selectedPromptSet || promptSetName);
    const nextPromptName = normalizeValue(selectedPromptName || promptName);
    if (!nextSetName || !nextPromptName) return;

    setIsLoading(true);
    try {
      const success = await deletePrompt(nextSetName, nextPromptName);
      if (!success) {
        throw new Error(hookError || 'Failed to delete Prompt Name.');
      }

      const names = await fetchPromptNames(nextSetName);
      setPromptNames(names);
      setSelectedPromptName('');
      setPromptName('');
      setAdditionalParameters('');
      await savePageAssignment(selectedPage, nextSetName, '');
      setPageStatus(`Assigned: ${nextSetName}`);

      toast({
        title: 'Prompt Name Deleted',
        description: `"${nextPromptName}" was removed from "${nextSetName}".`,
      });
    } catch (err) {
      toast({
        title: 'Error',
        description: err.message || 'Failed to delete Prompt Name.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const selectedPageLabel =
    PAGES.find((page) => page.value === selectedPage)?.label || selectedPage;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
          Image Generation Prompts
        </h1>
        <p className="text-slate-600 dark:text-slate-400">
          Assign global Prompt Sets and Prompt Names to any page, then reuse them across the
          platform.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-lg">Select Page</CardTitle>
          </CardHeader>
          <CardContent>
            <select
              value={selectedPage}
              onChange={(e) => setSelectedPage(e.target.value)}
              className="w-full px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-slate-blue/50"
            >
              {PAGES.map((page) => (
                <option key={page.value} value={page.value}>
                  {page.label}
                </option>
              ))}
            </select>

            <div className="mt-4 p-3 rounded-lg bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/50">
              <p className="text-[11px] text-slate-600 dark:text-slate-400 uppercase tracking-wider font-mono">
                Path
              </p>
              <p className="text-sm font-mono text-slate-900 dark:text-white mt-1">
                {selectedPage}
              </p>
            </div>

            <div className="mt-3 p-3 rounded-lg bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/50">
              <p className="text-[11px] text-slate-600 dark:text-slate-400 uppercase tracking-wider font-mono">
                Active Assignment
              </p>
              <p className="text-sm text-slate-900 dark:text-white mt-1">
                {pageStatus || 'Loading assignment...'}
              </p>
            </div>

            {hookError && (
              <div className="mt-3 p-2.5 rounded-lg bg-red-500/10 border border-red-500/30">
                <p className="text-[11px] text-red-700 dark:text-red-400 font-mono">{hookError}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">Prompt Library for {selectedPageLabel}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <label
                htmlFor="prompt-set-name"
                className="block text-sm font-semibold text-slate-900 dark:text-white mb-2"
              >
                Prompt Set
                <span className="text-red-500 ml-1">*</span>
              </label>
              <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_240px_auto_auto] gap-2">
                <input
                  id="prompt-set-name"
                  type="text"
                  value={promptSetName}
                  onChange={(e) => {
                    setPromptSetName(e.target.value);
                    if (e.target.value !== selectedPromptSet) {
                      setSelectedPromptSet('');
                      setPromptNames([]);
                      setSelectedPromptName('');
                      setPromptName('');
                      setAdditionalParameters('');
                    }
                  }}
                  disabled={isLoading}
                  placeholder="e.g., Azure Chibi, AWS Lego, Enterprise Hero"
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-slate-blue/50 disabled:opacity-50"
                />
                <select
                  value={selectedPromptSet}
                  onChange={(e) => handleSelectPromptSet(e.target.value)}
                  disabled={isLoading}
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-slate-blue/50 disabled:opacity-50"
                >
                  <option value="">Select Prompt Set...</option>
                  {promptSets.map((setName) => (
                    <option key={setName} value={setName}>
                      {setName}
                    </option>
                  ))}
                </select>
                <Button
                  onClick={handleSavePromptSet}
                  disabled={isLoading || !promptSetName.trim() || !primaryPrompt.trim()}
                  className="px-3 bg-green-600 hover:bg-green-700 text-white"
                  title="Save Prompt Set"
                >
                  <Check className="h-4 w-4" />
                </Button>
                <Button
                  onClick={() => setDeletePromptSetOpen(true)}
                  disabled={isLoading || !(selectedPromptSet || promptSetName)}
                  variant="destructive"
                  className="px-3"
                  title="Delete Prompt Set"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">
                Prompt Sets are global. Save once, then assign them to any page.
              </p>
            </div>

            <div>
              <label
                htmlFor="primary-prompt"
                className="block text-sm font-semibold text-slate-900 dark:text-white mb-2"
              >
                Primary Prompt
                <span className="text-red-500 ml-1">*</span>
              </label>
              <textarea
                id="primary-prompt"
                value={primaryPrompt}
                onChange={(e) => setPrimaryPrompt(e.target.value)}
                disabled={isLoading}
                placeholder="The shared base prompt for this Prompt Set. Every Prompt Name in the set will inherit this."
                className="w-full h-32 px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-slate-blue/50 disabled:opacity-50"
              />
              <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">
                This is the shared style anchor for the entire Prompt Set.
              </p>
            </div>

            <div>
              <label
                htmlFor="prompt-name"
                className="block text-sm font-semibold text-slate-900 dark:text-white mb-2"
              >
                Prompt Name
                <span className="text-red-500 ml-1">*</span>
              </label>
              <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_240px_auto_auto] gap-2">
                <input
                  id="prompt-name"
                  type="text"
                  value={promptName}
                  onChange={(e) => {
                    setPromptName(e.target.value);
                    if (e.target.value !== selectedPromptName) {
                      setSelectedPromptName('');
                    }
                  }}
                  disabled={isLoading}
                  placeholder="e.g., Hero, Deep Dive, Lego Team, Chibi Analyst"
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-slate-blue/50 disabled:opacity-50"
                />
                <select
                  value={selectedPromptName}
                  onChange={(e) => handleSelectPromptName(e.target.value)}
                  disabled={isLoading || !selectedPromptSet}
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-slate-blue/50 disabled:opacity-50"
                >
                  <option value="">Select Prompt Name...</option>
                  {promptNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <Button
                  onClick={handleSavePrompt}
                  disabled={
                    isLoading ||
                    !promptSetName.trim() ||
                    !primaryPrompt.trim() ||
                    !promptName.trim()
                  }
                  className="px-3 bg-green-600 hover:bg-green-700 text-white"
                  title="Save Prompt Name"
                >
                  <Check className="h-4 w-4" />
                </Button>
                <Button
                  onClick={() => setDeletePromptOpen(true)}
                  disabled={isLoading || !selectedPromptSet || !(selectedPromptName || promptName)}
                  variant="destructive"
                  className="px-3"
                  title="Delete Prompt Name"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">
                Prompt Names are variations inside the Prompt Set. Choose one to assign it to the
                selected page.
              </p>
            </div>

            <div>
              <label
                htmlFor="additional-parameters"
                className="block text-sm font-semibold text-slate-900 dark:text-white mb-2"
              >
                Additional Parameters
                <span className="text-slate-400">(Optional)</span>
              </label>
              <textarea
                id="additional-parameters"
                value={additionalParameters}
                onChange={(e) => setAdditionalParameters(e.target.value)}
                disabled={isLoading}
                placeholder="What makes this Prompt Name different from others in the same Prompt Set: composition, props, lighting, camera angle, character variation, palette, etc."
                className="w-full h-24 px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-slate-blue/50 disabled:opacity-50"
              />
              <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">
                These parameters differentiate one Prompt Name from another while keeping the same
                Primary Prompt.
              </p>
            </div>

            <div>
              <p className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                Per-Slot Prompt Templates
                <span className="text-slate-400 ml-1">(Optional)</span>
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {SLOT_TEMPLATE_FIELDS.map((field) => (
                  <div key={field.key}>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
                      {field.label}
                    </label>
                    <textarea
                      value={slotTemplates[field.key]}
                      onChange={(e) =>
                        setSlotTemplates((prev) => ({ ...prev, [field.key]: e.target.value }))
                      }
                      disabled={isLoading}
                      placeholder={field.placeholder}
                      className="w-full h-24 px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-slate-blue/50 disabled:opacity-50"
                    />
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-2">
                These templates let you steer hero and secondary image composition from the prompt
                library instead of relying on backend defaults.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-slate-200/50 dark:border-slate-700/30 bg-slate-50/50 dark:bg-slate-800/20">
        <CardContent className="pt-6">
          <div className="space-y-2 text-sm">
            <p className="font-semibold text-slate-900 dark:text-white">
              How Image Generation Prompt Sets Work
            </p>
            <ul className="space-y-1 text-slate-600 dark:text-slate-400 ml-4">
              <li>
                • <strong>Pages:</strong> Select any page first. That page can use any saved Prompt
                Set and Prompt Name.
              </li>
              <li>
                • <strong>Prompt Set:</strong> A global group of prompts that share one Primary
                Prompt.
              </li>
              <li>
                • <strong>Primary Prompt:</strong> The shared foundation for every Prompt Name in
                the Prompt Set.
              </li>
              <li>
                • <strong>Prompt Name:</strong> A named variation inside the Prompt Set.
              </li>
              <li>
                • <strong>Additional Parameters:</strong> The part that makes each Prompt Name
                unique while keeping the same Primary Prompt.
              </li>
              <li>
                • <strong>Per-Slot Templates:</strong> Optional hero and secondary image guidance
                saved with each Prompt Name for multi-image generation.
              </li>
              <li>
                • <strong>Green Check:</strong> Save the Prompt Set or Prompt Name from its own row.
              </li>
              <li>
                • <strong>Red X:</strong> Delete the selected Prompt Set or Prompt Name from its own
                row.
              </li>
              <li>
                • Selecting a Prompt Set or Prompt Name assigns it to the page currently selected on
                the left.
              </li>
              <li>
                • New Content uses the assigned Prompt Name slot templates when generating image
                sets for that page.
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <KeywordMatrixPanel />

      <ConfirmModal
        open={deletePromptSetOpen}
        title={`Delete "${selectedPromptSet || promptSetName}"?`}
        description="This Prompt Set and all Prompt Names inside it will be permanently deleted."
        confirmLabel="Delete"
        onConfirm={doDeletePromptSet}
        onCancel={() => setDeletePromptSetOpen(false)}
      />

      <ConfirmModal
        open={deletePromptOpen}
        title={`Delete "${selectedPromptName || promptName}"?`}
        description="This Prompt Name will be permanently deleted from the selected Prompt Set."
        confirmLabel="Delete"
        onConfirm={doDeletePrompt}
        onCancel={() => setDeletePromptOpen(false)}
      />
    </div>
  );
}
