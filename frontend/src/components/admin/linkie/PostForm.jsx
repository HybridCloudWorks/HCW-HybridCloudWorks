/**
 * Add a Post — the hand-written half of the Links tab (#577).
 *
 * Split out of LinksTab because a form's every field is a branch, and Qlty
 * counts them all into whichever function holds them: with this card inline the
 * tab measured 20.
 */
import React from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Plus } from 'lucide-react';
import { LINKIE_POST_TYPES, LINKIE_PROVIDERS } from '@/lib/linkie';
import PostImageField from './PostImageField';

/**
 * One labelled `<select>` over a list of plain string values.
 *
 * Provider and Post Type were the same eighteen lines twice, which is what
 * Qlty flagged on #626 as 18 duplicated lines at mass 86.
 */
function FormSelect({ id, label, value, options, onChange }) {
  return (
    <div>
      <Label className="text-xs" htmlFor={id}>
        {label}
      </Label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function PostForm({
  form,
  setForm,
  busyId,
  canWrite,
  uploadingImage,
  onUploadingChange,
  onSubmit,
}) {
  const setField = (field) => (value) => setForm((f) => ({ ...f, [field]: value }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add a Post</CardTitle>
        <CardDescription className="text-xs">
          A Linkie post has no title. Its caption is the nearest field, so that is where an article
          headline goes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label className="text-xs" htmlFor="linkie-post-url">
            URL
          </Label>
          <Input
            id="linkie-post-url"
            value={form.url}
            onChange={(e) => setField('url')(e.target.value)}
            placeholder="https://hybridcloudworks.com/…"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <FormSelect
            id="linkie-post-provider"
            label="Provider"
            value={form.provider}
            options={LINKIE_PROVIDERS}
            onChange={setField('provider')}
          />
          <FormSelect
            id="linkie-post-type"
            label="Post Type"
            value={form.postType}
            options={LINKIE_POST_TYPES}
            onChange={setField('postType')}
          />
        </div>
        <div>
          <Label className="text-xs" htmlFor="linkie-post-account">
            Account Name
          </Label>
          <Input
            id="linkie-post-account"
            value={form.accountName}
            onChange={(e) => setField('accountName')(e.target.value)}
          />
        </div>
        <div>
          <Label className="text-xs" htmlFor="linkie-post-text">
            Text (caption)
          </Label>
          <Input
            id="linkie-post-text"
            value={form.text}
            onChange={(e) => setField('text')(e.target.value)}
            placeholder="My latest article"
          />
        </div>
        <PostImageField
          imageUrl={form.imageUrl}
          onImageChange={setField('imageUrl')}
          uploading={uploadingImage}
          onUploadingChange={onUploadingChange}
        />
        <Button
          size="sm"
          onClick={onSubmit}
          disabled={busyId !== null || !canWrite || uploadingImage}
          className="gap-1.5"
        >
          {busyId === 'new' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          Add Post
        </Button>
      </CardContent>
    </Card>
  );
}
