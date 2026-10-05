import { useState } from 'react';
import { Eye, EyeOff, Info, ShieldCheck, X, ExternalLink } from 'lucide-react';
import { Modal, Badge, cx, inputCls } from './ui.jsx';

/**
 * Masked input for API tokens. The value lives only in React state for this tab:
 * it is never written to localStorage, IndexedDB, cookies, exports or the URL.
 * Autocomplete / password-manager hints are disabled so browsers do not offer to save it.
 */
export default function SecretInput({ value, onChange, placeholder = 'hf_…', label = 'Hugging Face token', provider = 'huggingface' }) {
  const [show, setShow] = useState(false);
  const [info, setInfo] = useState(false);
  const [fieldName] = useState(() => `secret-${provider}-${Math.random().toString(36).slice(2, 7)}`);
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1">
          <input
            type={show ? 'text' : 'password'}
            value={value}
            onChange={(e) => onChange(e.target.value.trim())}
            placeholder={placeholder}
            aria-label={label}
            // not a login form: ask browsers and password managers not to save or autofill it
            autoComplete="off"
            name={fieldName}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            data-1p-ignore="true"
            data-lpignore="true"
            data-bwignore="true"
            data-form-type="other"
            className={cx(inputCls, 'pr-16 font-mono')}
          />
          <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
            {value && (
              <button type="button" onClick={() => onChange('')} className="rounded p-1 text-slate-400 hover:text-rose-600" title="Clear token from memory" aria-label="Clear token">
                <X className="h-4 w-4" />
              </button>
            )}
            <button type="button" onClick={() => setShow(!show)} className="rounded p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200" title={show ? 'Hide token' : 'Show token'} aria-label={show ? 'Hide token' : 'Show token'}>
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setInfo(true)}
          className="flex h-9 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium text-brand-700 ring-1 ring-brand-200 hover:bg-brand-50 dark:text-brand-300 dark:ring-brand-800 dark:hover:bg-brand-900/30"
          aria-label="Token safety and best practices"
        >
          <Info className="h-4 w-4" /> Safety
        </button>
      </div>
      <p className="mt-1 flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
        {value ? 'Held in memory for this tab only — never saved. Cleared when you reload or close the tab.' : 'Not saved anywhere: you will enter it again after a reload.'}
      </p>
      <TokenSafetyModal open={info} onClose={() => setInfo(false)} provider={provider} />
    </div>
  );
}

export function TokenSafetyModal({ open, onClose, provider = 'huggingface' }) {
  const hf = provider === 'huggingface';
  return (
    <Modal open={open} onClose={onClose} title="Your token: how it is handled & best practices">
      <div className="space-y-5 p-5 text-sm">
        <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
          <h4 className="mb-2 flex items-center gap-1.5 font-semibold text-emerald-800 dark:text-emerald-300">
            <ShieldCheck className="h-4 w-4" /> Our guarantee: the token is never saved
          </h4>
          <ul className="list-disc space-y-1 pl-5 text-emerald-900 dark:text-emerald-200">
            <li>It is kept only in this browser tab’s memory (a JavaScript variable).</li>
            <li>It is <b>never</b> written to localStorage, IndexedDB, cookies, session exports, benchmark files or the URL. Tokens saved by older versions of the app are deleted automatically.</li>
            <li>Reloading or closing the tab erases it — that is why you enter it once per visit.</li>
            <li>
              It is sent only over HTTPS, directly from your browser to {hf ? <code>router.huggingface.co</code> : 'the endpoint you configured'}. This website has no server of its own, so it never receives the token.
            </li>
            <li>The field is masked, and password managers are asked not to store it. If your browser still offers to save it as a password, choose <b>“Never”</b> — as long as you don’t save it in your browser, it is stored nowhere.</li>
          </ul>
        </section>
        {hf && (
          <section>
            <h4 className="mb-2 font-semibold">Best practices</h4>
            <ol className="list-decimal space-y-1.5 pl-5 text-slate-600 dark:text-slate-300">
              <li>
                Create a <b>fine-grained</b> token with <b>only</b> the permission “Make calls to Inference Providers”. Don’t use a token with write or repository access.
              </li>
              <li>Give it a recognisable name (e.g. “RAG AI Studio”) so you can revoke it independently of your other tokens.</li>
              <li>Use it only on a device you trust; avoid shared or public computers.</li>
              <li>Never paste it into chats, documents, screenshots, issues or source code.</li>
              <li>Revoke or rotate it at huggingface.co/settings/tokens if you think it was exposed, or when you no longer need it.</li>
              <li>Check your usage and credits on the Hugging Face billing page from time to time.</li>
            </ol>
            <a className="mt-3 inline-flex items-center gap-1 text-brand-700 underline dark:text-brand-300" href="https://huggingface.co/settings/tokens" target="_blank" rel="noreferrer noopener">
              Manage your tokens <ExternalLink className="h-3 w-3" />
            </a>
          </section>
        )}
        <div className="flex flex-wrap gap-1.5">
          <Badge color="green">masked input</Badge>
          <Badge color="green">memory only</Badge>
          <Badge color="green">HTTPS to provider only</Badge>
          <Badge color="green">no server</Badge>
        </div>
      </div>
    </Modal>
  );
}
