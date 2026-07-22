import React, { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, Loader2, Send } from 'lucide-react';
import { db } from '@/lib/firebaseConfig';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';

const PROVIDER_OPTIONS = ['Github', 'Terraform'];

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

const EMPTY_FORM = {
  title: '',
  summary: '',
  provider: 'Github',
  language: '',
  repoUrl: '',
  codeSnippet: '',
  explanation: '',
};

export default function CoderCornerSubmissionPage() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!form.title.trim()) {
      setError('Title is required.');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const title = form.title.trim();
      const summary = form.summary.trim();
      const slug = slugify(title);
      const articleContent = [
        form.explanation.trim(),
        form.codeSnippet.trim()
          ? `\`\`\`${form.language.trim() || ''}\n${form.codeSnippet.trim()}\n\`\`\``
          : '',
      ]
        .filter(Boolean)
        .join('\n\n');

      await addDoc(collection(db, 'content'), {
        type: 'coder_corner',
        contentStatus: 'ingested',
        storageCollection: 'content',
        publishTarget: 'coder_corner',
        Live: false,
        approvedForBlog: false,
        source: 'template-form',
        slug,
        title,
        Title: title,
        summary,
        Summary: summary,
        content: articleContent,
        Content: articleContent,
        postContent: articleContent,
        cloudProvider: form.provider,
        'Cloud Provider': form.provider,
        category: 'Coder Corner',
        language: form.language.trim(),
        repoUrl: form.repoUrl.trim(),
        codeSnippet: form.codeSnippet.trim(),
        explanation: form.explanation.trim(),
        tags: ['coder-corner', form.provider.toLowerCase()].filter(Boolean),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setSubmitted(true);
      setForm(EMPTY_FORM);
    } catch (submitError) {
      setError(submitError.message || 'Submission failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <Helmet>
        <title>Coder Corner Templates | HCW</title>
        <meta
          name="description"
          content="Submit Coder Corner technical entries for GitHub and Terraform workflows."
        />
      </Helmet>

      <div className="mb-8">
        <h1 className="text-3xl sm:text-4xl font-bold mb-2">Coder Corner Template Submission</h1>
        <p className="text-muted-foreground mb-3">
          Submit practical implementation notes, snippets, and patterns for engineering workflows.
        </p>
        <div className="flex items-center gap-2">
          <Badge variant="outline">GitHub</Badge>
          <Badge variant="outline">Terraform</Badge>
        </div>
      </div>

      {submitted ? (
        <Card className="border-green-500/30 bg-card/40">
          <CardContent className="pt-8 pb-8 text-center space-y-3">
            <CheckCircle className="h-12 w-12 text-green-500 mx-auto" />
            <h2 className="text-xl font-semibold">Coder Corner entry submitted</h2>
            <p className="text-muted-foreground text-sm">
              The entry is now in review and can be edited before publication.
            </p>
            <Button onClick={() => setSubmitted(false)}>Submit another</Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-card/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Send className="h-5 w-5 text-primary" />
              New Coder Corner Entry
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium">Title</p>
                  <Input
                    value={form.title}
                    onChange={(event) => handleChange('title', event.target.value)}
                    placeholder="Terraform module validation pipeline"
                    required
                  />
                </div>
                <div>
                  <p className="text-sm font-medium">Provider</p>
                  <select
                    className="w-full mt-2 rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={form.provider}
                    onChange={(event) => handleChange('provider', event.target.value)}
                  >
                    {PROVIDER_OPTIONS.map((provider) => (
                      <option key={provider} value={provider}>
                        {provider}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <p className="text-sm font-medium">Summary</p>
                <Textarea
                  value={form.summary}
                  onChange={(event) => handleChange('summary', event.target.value)}
                  placeholder="What problem this snippet solves"
                  rows={3}
                />
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium">Language / Stack</p>
                  <Input
                    value={form.language}
                    onChange={(event) => handleChange('language', event.target.value)}
                    placeholder="HCL, YAML, Bash"
                  />
                </div>
                <div>
                  <p className="text-sm font-medium">Repository URL (optional)</p>
                  <Input
                    value={form.repoUrl}
                    onChange={(event) => handleChange('repoUrl', event.target.value)}
                    placeholder="https://github.com/org/repo"
                  />
                </div>
              </div>

              <div>
                <p className="text-sm font-medium">Implementation Notes</p>
                <Textarea
                  value={form.explanation}
                  onChange={(event) => handleChange('explanation', event.target.value)}
                  placeholder="Explain approach, pitfalls, and expected outcomes"
                  rows={5}
                />
              </div>

              <div>
                <p className="text-sm font-medium">Code Snippet</p>
                <Textarea
                  value={form.codeSnippet}
                  onChange={(event) => handleChange('codeSnippet', event.target.value)}
                  placeholder="Paste sample code"
                  rows={10}
                />
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <Button type="submit" disabled={submitting} className="w-full md:w-auto">
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  'Submit Coder Corner entry'
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
