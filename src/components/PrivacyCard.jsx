import { ShieldCheck, CloudUpload, Lock, AlertTriangle } from 'lucide-react';
import { Card, CardHeader, Toggle, Badge } from './ui.jsx';
import { useStore } from '../state/store.jsx';
import { dataClass, dataRecipient, dataHost } from '../lib/providers.js';

export const STAYS = [
  'Your original files, extracted text, chunks, embeddings and search indexes',
  'Sessions, answers, evaluations and Evaluation Lab runs (stored in this browser’s IndexedDB)',
  'Tokens and API keys: memory only, never saved, sent only to the provider you chose',
  'Usage counters: counts only, never prompts or keys',
];

export const SENT = [
  'Your question, plus your last two questions and their (shortened) answers',
  'The retrieved excerpts used to answer (about k passages, roughly 1 000 to 2 000 tokens)',
  'For the LLM judge: the excerpts again plus the answer',
  'When enabled: follow-up rewriting, HyDE and AI starter questions (section titles and one excerpt)',
];

/** Honest summary of what leaves the device, plus the Confidential mode switch. */
export default function PrivacyCard() {
  const { settings: s, setSettings } = useStore();
  const cloud = dataClass(s) === 'cloud';
  return (
    <Card>
      <CardHeader
        icon={ShieldCheck}
        title="Data and privacy"
        subtitle="Where your documents go when you upload confidential files"
        right={cloud ? <Badge color="amber"><CloudUpload className="h-3.5 w-3.5" /> Excerpts sent to {dataRecipient(s)}</Badge> : <Badge color="green"><Lock className="h-3.5 w-3.5" /> Nothing leaves this device</Badge>}
      />
      <div className="space-y-5 p-6 pt-3 text-sm">
        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-[14px] bg-emerald-50 p-4 dark:bg-emerald-950/30">
            <h4 className="mb-2 flex items-center gap-1.5 font-semibold text-emerald-800 dark:text-emerald-300">
              <Lock className="h-4 w-4" /> Always stays on this device
            </h4>
            <ul className="list-disc space-y-1 pl-5 text-emerald-900 dark:text-emerald-200">
              {STAYS.map((t) => <li key={t}>{t}</li>)}
            </ul>
            <p className="mt-2 text-emerald-900/80 dark:text-emerald-200/80">
              This site is static (GitHub Pages or Hugging Face Spaces) and has no upload endpoint, so the people hosting it never receive your files. Model downloads from Hugging Face and jsDelivr fetch model files only and send no document text.
            </p>
          </section>
          <section className="rounded-[14px] bg-amber-50 p-4 dark:bg-amber-950/30">
            <h4 className="mb-2 flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-300">
              <CloudUpload className="h-4 w-4" /> Sent only when you use a cloud model
            </h4>
            <ul className="list-disc space-y-1 pl-5 text-amber-900 dark:text-amber-200">
              {SENT.map((t) => <li key={t}>{t}</li>)}
            </ul>
            <p className="mt-2 text-amber-900/80 dark:text-amber-200/80">
              These excerpts can contain confidential text. Hugging Face, Claude, DeepSeek, OpenAI, Gemini, Groq, Mistral, OpenRouter and remote custom endpoints receive them, and their own data policies decide retention and training use.
              {cloud && <> Right now that is <b>{dataRecipient(s)}</b> (<code>{dataHost(s)}</code>).</>}
            </p>
          </section>
        </div>
        <Toggle
          checked={!!s.confidential}
          onChange={(v) => setSettings(v ? { confidential: true, aiSuggestions: false } : { confidential: false })}
          label="Confidential mode"
          hint="Blocks every model that would send text off this device. Use Extractive, the in-browser model or a model on localhost (Ollama, LM Studio). Recommended for contracts, medical records, HR files and anything under NDA."
        />
        <p className="flex items-start gap-2 text-xs text-slate-500 dark:text-slate-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Outside the app’s control: browser extensions that can read pages, shared or managed computers, and device backups. Stored documents are not encrypted by the app; they rely on your device and browser profile. Use Clear all data below when you are done on a shared machine.
        </p>
      </div>
    </Card>
  );
}
