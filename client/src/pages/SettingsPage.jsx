import { useEffect, useState } from 'react';
import { Camera, Code2, LoaderCircle, Save, Sun, Moon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import api, { getMessage } from '../services/api.js';
import { ErrorState, LoadingState } from '../components/common/StateView.jsx';

export default function SettingsPage() {
  const { user, setUser } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [githubName, setGithubName] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load() {
    setLoading(true); setError('');
    try {
      const { data } = await api.get('/users/me/profile');
      const value = data.data;
      setProfile(value);
      setForm({ ...value.user, email: value.email, skills: value.user.skills?.join(', ') || '', languages: value.user.languages?.join(', ') || '', techStack: value.user.techStack?.join(', ') || '', socialLinks: value.user.socialLinks || { github: '', linkedin: '', portfolio: '' } });
    } catch (requestError) { setError(getMessage(requestError)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function update(event) {
    const { name, value } = event.target;
    if (name.startsWith('social.')) {
      const key = name.split('.')[1];
      setForm((current) => ({ ...current, socialLinks: { ...current.socialLinks, [key]: value } }));
    } else setForm((current) => ({ ...current, [name]: value }));
  }

  async function save(event) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      const payload = { ...form, skills: form.skills.split(',').map((x) => x.trim()).filter(Boolean), languages: form.languages.split(',').map((x) => x.trim()).filter(Boolean), techStack: form.techStack.split(',').map((x) => x.trim()).filter(Boolean) };
      delete payload.email;
      const { data } = await api.put('/users/profile', payload);
      setProfile((current) => ({ ...current, user: data.data.user }));
      setUser((current) => ({ ...current, ...data.data.user }));
      setMessage('Profile saved.');
    } catch (requestError) { setError(getMessage(requestError)); }
    finally { setBusy(false); }
  }

  async function uploadAvatar(event) {
    const file = event.target.files?.[0]; if (!file) return;
    setUploading(true); setError(''); setMessage('');
    try {
      const body = new FormData(); body.append('avatar', file);
      const { data } = await api.post('/users/profile/avatar', body, { headers: { 'Content-Type': 'multipart/form-data' } });
      setForm((current) => ({ ...current, avatarUrl: data.data.avatarUrl }));
      setUser((current) => ({ ...current, avatarUrl: data.data.avatarUrl }));
      setMessage('Avatar uploaded.');
    } catch (requestError) { setError(getMessage(requestError)); }
    finally { setUploading(false); event.target.value = ''; }
  }

  async function syncGithub(event) {
    event?.preventDefault?.();
    if (!/^[A-Za-z0-9-]{1,39}$/.test(githubName)) { setError('Enter a valid GitHub username.'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      const { data } = await api.post('/users/profile/github-sync', { username: githubName });
      setForm((current) => ({ ...current, socialLinks: { ...current.socialLinks, github: data.data.github }, bio: data.data.bio || current.bio, avatarUrl: data.data.avatarUrl || current.avatarUrl, fullName: data.data.publicName || current.fullName }));
      setProfile((current) => ({ ...current, user: { ...current.user, avatarUrl: data.data.avatarUrl || current.user.avatarUrl, bio: data.data.bio || current.user.bio, fullName: data.data.publicName || current.user.fullName } }));
      setUser((current) => ({ ...current, avatarUrl: data.data.avatarUrl || current.avatarUrl, bio: data.data.bio || current.bio, fullName: data.data.publicName || current.fullName }));
      setMessage(`Synced public profile from GitHub. ${data.data.publicRepos} public repositories found.`);
    } catch (requestError) { setError(getMessage(requestError)); }
    finally { setBusy(false); }
  }

  if (loading) return <LoadingState label="Loading your profile…" />;
  if (error && !form) return <ErrorState message={error} onRetry={load} />;
  if (!form) return null;

  return <div className="page-stack"><div className="page-heading-row"><div><span className="eyebrow">YOUR ACCOUNT</span><h1>Profile & settings</h1><p>Help teammates understand what you work on and how to reach you.</p></div></div>{error && <div className="form-alert form-alert-error" role="alert">{error}</div>}{message && <div className="form-alert" role="status">{message}</div>}
    <form className="settings-form" onSubmit={save}><section className="panel settings-section"><div className="panel-heading"><div><span className="eyebrow">DEVELOPER PROFILE</span><h2>About you</h2></div></div><div className="avatar-editor"><span className="avatar avatar-large">{form.avatarUrl ? <img src={form.avatarUrl} alt="Profile avatar" /> : form.fullName?.[0]?.toUpperCase()}</span><label className="button button-quiet upload-button"><Camera size={14} />{uploading ? 'Uploading…' : 'Upload avatar'}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadAvatar} disabled={uploading} /></label><small>JPEG, PNG or WebP · up to 2 MB</small></div><div className="form-grid"><label>Full name<input name="fullName" value={form.fullName || ''} onChange={update} minLength={2} maxLength={80} required /></label><label>Username<input value={form.username || ''} disabled /><small>Username cannot be changed here.</small></label><label className="form-span-two">Email<input value={form.email} disabled /><small>Email is used for account access.</small></label><label className="form-span-two">Bio<textarea name="bio" value={form.bio || ''} onChange={update} maxLength={500} rows={3} /></label><label>Experience level<select name="experienceLevel" value={form.experienceLevel || 'Beginner'} onChange={update}><option>Beginner</option><option>Intermediate</option><option>Advanced</option></select></label><label>Skills <small>Comma separated</small><input name="skills" value={form.skills} onChange={update} placeholder="React, Node.js, MongoDB" /></label><label className="form-span-two">Programming languages <small>Comma separated</small><input name="languages" value={form.languages} onChange={update} placeholder="JavaScript, Python, Go" /></label><label className="form-span-two">Tech stack <small>Comma separated</small><input name="techStack" value={form.techStack} onChange={update} placeholder="Vite, Express, MongoDB" /></label></div></section>
      <section className="panel settings-section"><div className="panel-heading"><div><span className="eyebrow">FIND YOU ELSEWHERE</span><h2>Social links</h2></div></div><div className="form-grid"><label>GitHub profile<input name="social.github" value={form.socialLinks.github || ''} onChange={update} placeholder="https://github.com/username" /></label><label>LinkedIn profile<input name="social.linkedin" value={form.socialLinks.linkedin || ''} onChange={update} placeholder="https://linkedin.com/in/username" /></label><label className="form-span-two">Portfolio<input name="social.portfolio" value={form.socialLinks.portfolio || ''} onChange={update} placeholder="https://your-site.dev" /></label></div><div className="github-sync-form"><Code2 size={16} /><input value={githubName} onChange={(event) => setGithubName(event.target.value)} placeholder="GitHub username" aria-label="GitHub username" /><button type="button" className="button button-quiet" disabled={busy} onClick={syncGithub}>Import public profile</button></div></section>
      <section className="panel settings-section"><div className="panel-heading"><div><span className="eyebrow">APPEARANCE & SECURITY</span><h2>Preferences</h2></div></div><div className="preference-row"><span><strong>Color theme</strong><small>Theme preference is saved on this device.</small></span><button type="button" className="button button-quiet" onClick={toggleTheme}>{theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}{theme === 'dark' ? 'Switch to light' : 'Switch to dark'}</button></div><div className="preference-row"><span><strong>Password</strong><small>Request a password reset link if you need to change it.</small></span><Link className="button button-quiet" to="/forgot-password">Reset password</Link></div></section>
      <div className="form-actions"><button className="button" disabled={busy}>{busy ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />}{busy ? 'Saving…' : 'Save profile'}</button></div>
    </form>
  </div>;
}
