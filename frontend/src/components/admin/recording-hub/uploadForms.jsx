/**
 * The two ways to add a recording by hand: an audio file for Plaud Embedded to
 * transcribe, and a transcript pasted straight in (#576).
 *
 * Split from RecordingsTab for file complexity; both are sections of the
 * Recordings tab, as they were sections of the Plaud tab's Upload sub-tab.
 */
import React, { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Upload, CheckCircle, AlertCircle, FileAudio } from 'lucide-react';
import { postJSON } from '@/lib/api';
import { AUDIO_ACCEPT, MAX_AUDIO_UPLOAD_BYTES, readFileAsBase64 } from './recordingView';

export function AudioUploadForm({ onQueued }) {
  const [title, setTitle] = useState('');
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [queued, setQueued] = useState(null);
  const fileRef = useRef(null);
  const { toast } = useToast();

  const handleFileChange = (e) => {
    const picked = e.target.files?.[0] || null;
    setFile(picked);
    if (picked) setTitle((t) => t || picked.name.replace(/\.(mp3|m4a|wav)$/i, ''));
  };

  const handleUpload = async () => {
    if (!file || !title.trim()) {
      toast({ title: 'Title and an audio file are required', variant: 'destructive' });
      return;
    }
    if (file.size > MAX_AUDIO_UPLOAD_BYTES) {
      toast({
        title: 'File too large',
        description: 'The upload limit is 40 MB — about an hour at 64 kbps.',
        variant: 'destructive',
      });
      return;
    }
    setUploading(true);
    try {
      const dataBase64 = await readFileAsBase64(file);
      const res = await postJSON('cms/podcast/recordings/upload', {
        title: title.trim(),
        fileName: file.name,
        contentType: file.type || 'audio/mpeg',
        dataBase64,
      });
      setQueued({ jobId: res.jobId, title: title.trim(), fileName: file.name });
      setTitle('');
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      toast({
        title: 'Transcription queued',
        description: 'Plaud is transcribing it; the result appears under Stored recordings.',
      });
      onQueued?.(res);
    } catch (err) {
      toast({ title: 'Upload failed', description: err.message, variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-3 max-w-2xl">
      <div>
        <h3 className="font-semibold text-sm flex items-center gap-1.5">
          <FileAudio className="h-4 w-4" /> Upload audio for transcription
        </h3>
        <p className="text-xs text-slate-500 mt-1">
          Plaud Embedded transcribes the file with speaker labels and the transcript is stored here;
          the audio is kept only so Plaud can fetch it. MP3, M4A or WAV, up to 40 MB.
        </p>
      </div>
      <div>
        <Label htmlFor="audio-upload-title" className="text-xs">
          Title
        </Label>
        <Input
          id="audio-upload-title"
          className="mt-1 h-9"
          placeholder="Architecture review — Sept 8"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="audio-upload-file" className="text-xs">
          Audio file
        </Label>
        <input
          id="audio-upload-file"
          ref={fileRef}
          type="file"
          accept={AUDIO_ACCEPT}
          className="mt-1 block w-full text-xs"
          onChange={handleFileChange}
        />
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={handleUpload} disabled={uploading || !file || !title.trim()}>
          {uploading ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Upload className="h-4 w-4 mr-2" />
          )}
          Upload & transcribe
        </Button>
        {queued && (
          <span className="text-xs text-emerald-700 dark:text-emerald-300" role="status">
            Queued: {queued.title} ({queued.fileName}) — job {queued.jobId}
          </span>
        )}
      </div>
    </div>
  );
}

export function ManualPaste({ onSaved }) {
  const [title, setTitle] = useState('');
  const [transcript, setTranscript] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef(null);
  const { toast } = useToast();

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setTitle((t) => t || file.name.replace(/\.(txt|md)$/i, ''));
    const reader = new FileReader();
    reader.onload = (evt) => setTranscript(evt.target.result || '');
    reader.readAsText(file);
  };

  const handleSave = async () => {
    if (!title || !transcript) {
      toast({ title: 'Title and transcript are required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await postJSON('cms/recordings', {
        title,
        transcript,
        source: 'manual_upload',
        status: 'new',
      });
      setSaved(true);
      setTitle('');
      setTranscript('');
      toast({ title: 'Recording saved ✓', description: 'Find it under Stored recordings.' });
      onSaved?.();
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      toast({ title: 'Error saving', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h3 className="font-semibold text-sm">Paste a transcript</h3>
        <div className="mt-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-xs text-amber-700 dark:text-amber-300 flex gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />A manual fallback. If you&apos;ve
          connected Plaud on the Settings tab, the live library above has all your recordings
          instead.
        </div>
      </div>

      <div>
        <Label className="text-xs">Recording Title</Label>
        <Input
          className="mt-1 h-9"
          placeholder="Weekly Team Standup — May 25"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <div>
        <Label className="text-xs">Transcript</Label>
        <div className="mt-1 flex gap-2">
          <Textarea
            className="text-xs font-mono leading-relaxed"
            rows={12}
            placeholder="Paste your transcript here, or use the button to upload a .txt / .md file…"
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
          />
        </div>
      </div>

      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
          <Upload className="h-4 w-4 mr-2" /> Upload .txt / .md
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.md"
          className="hidden"
          onChange={handleFileChange}
        />
        <Button onClick={handleSave} disabled={saving || saved}>
          {saving ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <CheckCircle className="h-4 w-4 mr-2" />
          )}
          {saved ? 'Saved!' : 'Save Recording'}
        </Button>
      </div>
    </div>
  );
}

/**
 * Library and Upload were two halves of one duty, so they are sections here
 * rather than sub-tabs. `reloadKey` is bumped by an upload so the stored list
 * below the library picks it up without a second read being wired between two
 * components that no longer need to know about each other.
 */
