import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Code2, Copy, ExternalLink, Eye, Flag, LockKeyhole, Plus, Search, Share2, Trash2, X } from 'lucide-react';
import hljs from 'highlight.js/lib/common';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import api, { getMessage } from '../services/api.js';
import { EmptyState, ErrorState, LoadingState } from '../components/common/StateView.jsx';

const languageOptions = ['javascript', 'typescript', 'python', 'java', 'html', 'css', 'json', 'bash', 'sql', 'plaintext'];
const highlightCode = (code, language) => {
  try { return hljs.getLanguage(language) ? hljs.highlight(code, { language }).value : hljs.highlightAuto(code).value; }
  catch { return hljs.highlightAuto(code).value; }
};

function CodeBlock({ code, language }) {
  const highlighted = useMemo(() => highlightCode(code || '', language || 'plaintext'), [code, language]);
  return <pre className="snippet-code"><code className={`hljs language-${language || 'plaintext'}`} dangerouslySetInnerHTML={{ __html: highlighted }} /></pre>;
}

function SnippetForm({ initial, onCancel, onSave }) {
  const [form, setForm] = useState(initial || { title: '', description: '', code: '', language: 'javascript', tags: '', visibility: 'public' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    const payload = { ...form, tags: Array.isArray(form.tags) ? form.tags : form.tags.split(',').map((tag) => tag.trim()).filter(Boolean) };
    try { await onSave(payload); }
    catch (requestError) { setError(getMessage(requestError)); }
    finally { setBusy(false); }
  }
  return <form className="panel snippet-form" onSubmit={submit}><div className="panel-heading"><div><span className="eyebrow">CODE SHARING</span><h2>{initial ? 'Edit snippet' : 'New snippet'}</h2></div><button type="button" className="icon-button" onClick={onCancel} aria-label="Close"><X size={15} /></button></div><div className="form-grid"><label className="form-span-two">Title<input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} minLength={2} maxLength={120} required /></label><label className="form-span-two">Description<input value={form.description || ''} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} maxLength={1000} /></label><label>Language<select value={form.language} onChange={(event) => setForm((current) => ({ ...current, language: event.target.value }))}>{languageOptions.map((language) => <option value={language} key={language}>{language}</option>)}</select></label><label>Visibility<select value={form.visibility} onChange={(event) => setForm((current) => ({ ...current, visibility: event.target.value }))}><option value="public">Public</option><option value="private">Private</option></select></label><label className="form-span-two">Tags <small>Comma separated</small><input value={Array.isArray(form.tags) ? form.tags.join(', ') : form.tags} onChange={(event) => setForm((current) => ({ ...current, tags: event.target.value }))} /></label><label className="form-span-two">Code<textarea className="code-editor" spellCheck="false" value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))} maxLength={100000} required rows={12} /></label></div>{error && <div className="form-alert form-alert-error">{error}</div>}<div className="form-actions"><button type="button" className="button button-quiet" onClick={onCancel}>Cancel</button><button className="button" disabled={busy}>{busy ? 'Saving…' : 'Save snippet'}</button></div></form>;
}

export function SnippetsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [snippets, setSnippets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [copied, setCopied] = useState('');
  const [notice, setNotice] = useState('');

  async function load() {
    setLoading(true); setError('');
    try { const { data } = await api.get('/snippets', { params: { q: query || undefined, limit: 40 } }); setSnippets(data.data); }
    catch (requestError) { setError(getMessage(requestError)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [query]);

  async function save(payload) {
    const { data } = editing ? await api.put(`/snippets/${editing._id}`, payload) : await api.post('/snippets', payload);
    if (editing) setSnippets((items) => items.map((item) => item._id === editing._id ? data.data : item));
    else setSnippets((items) => [data.data, ...items]);
    setEditing(null); setShowForm(false);
  }

  async function copyCode(snippet) {
    try { await navigator.clipboard.writeText(snippet.code); setCopied(snippet._id); window.setTimeout(() => setCopied(''), 1600); }
    catch { setError('Clipboard access is unavailable in this browser. Select and copy the code instead.'); }
  }

  async function copyLink(snippet) {
    const link = `${window.location.origin}/snippets/${snippet._id}`;
    try { await navigator.clipboard.writeText(link); setCopied(`link-${snippet._id}`); window.setTimeout(() => setCopied(''), 1600); }
    catch { setError(link); }
  }

  async function remove(snippet) {
    if (!window.confirm(`Delete “${snippet.title}”?`)) return;
    try { await api.delete(`/snippets/${snippet._id}`); setSnippets((items) => items.filter((item) => item._id !== snippet._id)); }
    catch (requestError) { setError(getMessage(requestError)); }
  }

  async function reportSnippet(snippet) {
    const reason = window.prompt('Briefly explain why this snippet should be reviewed:');
    if (!reason) return;
    try {
      await api.post('/reports', { targetType: 'Snippet', target: snippet._id, reason });
      setNotice('Report submitted for review.');
    } catch (requestError) { setError(getMessage(requestError)); }
  }

  return <div className="page-stack"><div className="page-heading-row"><div><span className="eyebrow">SHARE REUSABLE KNOWLEDGE</span><h1>Code sharing</h1><p>Small solutions, documented and ready to use again.</p></div>{user && <button className="button" onClick={() => { setEditing(null); setShowForm((show) => !show); }}><Plus size={15} /> New snippet</button>}</div>
    <form className="filter-bar" onSubmit={(event) => { event.preventDefault(); setQuery(search); }}><Search size={15} /><input placeholder="Search snippets, tags, or language…" aria-label="Search snippets" value={search} onChange={(event) => setSearch(event.target.value)} /><button className="button button-quiet">Search</button></form>
    {(showForm || editing) && <SnippetForm initial={editing} onCancel={() => { setShowForm(false); setEditing(null); }} onSave={save} />}
    {error && <div className="form-alert form-alert-error" role="alert">{error}</div>}{notice && <div className="form-alert" role="status">{notice}</div>}
    {loading ? <LoadingState label="Loading snippets…" /> : error && !snippets.length ? <ErrorState message={error} onRetry={load} /> : snippets.length ? <div className="snippet-grid">{snippets.map((snippet) => {
      const ownerId = String(snippet.author?._id ?? snippet.author?.id ?? '');
      const canEdit = user && (ownerId === user.id || user.role === 'admin');
      return <article className="panel snippet-card" key={snippet._id}><div className="snippet-card-head"><span className="snippet-language"><Code2 size={14} /> {snippet.language}</span><span className="snippet-visibility">{snippet.visibility === 'private' ? <LockKeyhole size={12} /> : <Eye size={12} />}{snippet.visibility}</span></div><Link to={`/snippets/${snippet._id}`} className="snippet-title"><h2>{snippet.title}</h2></Link><p>{snippet.description || 'A reusable code snippet.'}</p><div className="snippet-tags">{snippet.tags?.map((tag) => <span key={tag}>#{tag}</span>)}</div><CodeBlock code={snippet.code} language={snippet.language} /><div className="snippet-card-actions"><button className="button button-quiet" onClick={() => copyCode(snippet)}><Copy size={13} />{copied === snippet._id ? 'Copied' : 'Copy code'}</button><button className="icon-button" onClick={() => copyLink(snippet)} aria-label="Copy snippet link" title="Copy share link"><Share2 size={14} /></button>{user && !canEdit && <button className="icon-button" onClick={() => reportSnippet(snippet)} aria-label={`Report ${snippet.title}`} title="Report snippet"><Flag size={13} /></button>}{canEdit && <button className="icon-button" onClick={() => { setEditing(snippet); setShowForm(false); }} aria-label="Edit snippet"><ExternalLink size={14} /></button>}{canEdit && <button className="icon-button" onClick={() => remove(snippet)} aria-label="Delete snippet"><Trash2 size={14} /></button>}</div>{copied === `link-${snippet._id}` && <small className="copy-feedback">Share link copied</small>}</article>;
    })}</div> : <EmptyState title="No snippets found" description="Save a useful code solution for your team or community." action={user ? <button className="button" onClick={() => setShowForm(true)}><Plus size={14} /> Create snippet</button> : <Link className="button" to="/register">Join to share code</Link>} />}
  </div>;
}

export function SnippetDetailPage() {
  const { snippetId } = useParams();
  const [snippet, setSnippet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  async function load() { setLoading(true); setError(''); try { const { data } = await api.get(`/snippets/${snippetId}`); setSnippet(data.data); } catch (requestError) { setError(getMessage(requestError)); } finally { setLoading(false); } }
  useEffect(() => { load(); }, [snippetId]);
  async function copy() { try { await navigator.clipboard.writeText(snippet.code); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { setError('Clipboard access is unavailable.'); } }
  if (loading) return <main className="public-content page-width"><LoadingState label="Loading snippet…" /></main>;
  if (error || !snippet) return <main className="public-content page-width"><ErrorState message={error || 'Snippet not found.'} onRetry={load} /></main>;
  return <main className="public-content page-width"><Link className="back-link" to="/snippets"><ArrowLeft size={14} /> Code sharing</Link><article className="panel snippet-detail"><div className="snippet-card-head"><span className="snippet-language"><Code2 size={14} /> {snippet.language}</span><span className="snippet-visibility">{snippet.visibility}</span></div><h1>{snippet.title}</h1><p>{snippet.description}</p><div className="snippet-tags">{snippet.tags?.map((tag) => <span key={tag}>#{tag}</span>)}</div><CodeBlock code={snippet.code} language={snippet.language} /><button className="button" onClick={copy}><Copy size={14} /> {copied ? 'Copied' : 'Copy code'}</button></article></main>;
}
