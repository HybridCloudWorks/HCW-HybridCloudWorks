import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CheckCircle, Loader2, Send } from 'lucide-react';
import { db } from '@/lib/firebaseConfig';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';

const MAX_CONTENT_LENGTH = 50000;
const VALID_URL_RE = /^https?:\/\/.+\..+/;

const PROVIDER_OPTIONS = ['Azure', 'Aws', 'Gcp', 'Github', 'Terraform', 'Finops'];

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
  provider: 'Azure',
  tags: '',
  sourceUrl: '',
  content: '',
};

export default function BlogSubmissionPage() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  useEffect(() => {
    if (!submitted) return;
    const timer = setTimeout(() => setSubmitted(false), 5000);
    return () => clearTimeout(timer);
  }, [submitted]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!form.title.trim()) {
      setError('Title is required.');
      return;
    }
    if (form.sourceUrl.trim() && !VALID_URL_RE.test(form.sourceUrl.trim())) {
      setError('Source URL must be a valid http/https URL.');
      return;
    }
    if (form.content.length > MAX_CONTENT_LENGTH) {
      setError(`Content must be under ${MAX_CONTENT_LENGTH / 1000}KB.`);
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const title = form.title.trim();
      const summary = form.summary.trim();
      const content = form.content.trim();
      const slug = slugify(title);

      await addDoc(collection(db, 'content'), {
        type: 'blog',
        contentStatus: 'ingested',
        storageCollection: 'content',
        publishTarget: 'blog',
        Live: false,
        approvedForBlog: false,
        source: 'template-form',
        slug,
        title,
        Title: title,
        summary,
        Summary: summary,
        content,
        Content: content,
        postContent: content,
        cloudProvider: form.provider,
        'Cloud Provider': form.provider,
        tags: form.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
        sourceUrl: form.sourceUrl.trim(),
        'CD Url': form.sourceUrl.trim(),
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
        <title>Blog Templates | HCW</title>
        <meta
          name="description"
          content="Submit draft blog content into the HCW review and publish workflow."
        />
      </Helmet>

      <div className="mb-8">
        <h1 className="text-3xl sm:text-4xl font-bold mb-2">Blog Template Submission</h1>
        <p className="text-muted-foreground">
          Create a blog draft and send it to the admin review queue before publishing.
        </p>
      </div>

      {submitted ? (
        <Card className="border-green-500/30 bg-card/40">
          <CardContent className="pt-8 pb-8 text-center space-y-3">
            <CheckCircle className="h-12 w-12 text-green-500 mx-auto" />
            <h2 className="text-xl font-semibold">Blog draft submitted</h2>
            <p className="text-muted-foreground text-sm">
              The draft is now in the content review queue with status ingested.
            </p>
            <Button onClick={() => setSubmitted(false)}>Submit another</Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-card/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Send className="h-5 w-5 text-primary" />
              New Blog Draft
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
                    placeholder="Enter blog title"
                    required
                  />
                </div>
                <div>
                  <p className="text-sm font-medium">Cloud Provider</p>
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
                  placeholder="Short summary for preview cards"
                  rows={3}
                />
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium">Tags (comma-separated)</p>
                  <Input
                    value={form.tags}
                    onChange={(event) => handleChange('tags', event.target.value)}
                    placeholder="kubernetes, finops, optimization"
                  />
                </div>
                <div>
                  <p className="text-sm font-medium">Source URL (optional)</p>
                  <Input
                    value={form.sourceUrl}
                    onChange={(event) => handleChange('sourceUrl', event.target.value)}
                    placeholder="https://example.com"
                  />
                </div>
              </div>

              <div>
                <p className="text-sm font-medium">Blog Content</p>
                <Textarea
                  value={form.content}
                  onChange={(event) => handleChange('content', event.target.value)}
                  placeholder="Write markdown or plain text content"
                  rows={12}
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
                  'Submit blog draft'
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
