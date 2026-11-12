import { useEffect, useState } from 'react';
import { BarChart3, Eye, EyeOff, Flag, Shield, Users } from 'lucide-react';
import api, { getMessage } from '../services/api.js';
import { EmptyState, ErrorState, LoadingState } from '../components/common/StateView.jsx';

export default function AdminPage() {
  const [stats, setStats] = useState(null);
  const [section, setSection] = useState('overview');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function loadStats() {
    setLoading(true); setError('');
    try { const { data } = await api.get('/admin/stats'); setStats(data.data); }
    catch (requestError) { setError(getMessage(requestError)); }
    finally { setLoading(false); }
  }
  async function loadSection() {
    if (section === 'overview') return loadStats();
    setLoading(true); setError('');
    try { const { data } = await api.get(`/admin/${section}`, { params: { limit: 100 } }); setRows(data.data); }
    catch (requestError) { setError(getMessage(requestError)); }
    finally { setLoading(false); }
  }
  useEffect(() => { loadSection(); }, [section]);

  async function suspend(user, suspended) {
    try { await api.put(`/admin/users/${user._id}/suspension`, { suspended }); setRows((items) => items.map((item) => item._id === user._id ? { ...item, suspendedAt: suspended ? new Date().toISOString() : null } : item)); }
    catch (requestError) { setError(getMessage(requestError)); }
  }
  async function moderate(project) {
    const moderationStatus = project.moderationStatus === 'hidden' ? 'visible' : 'hidden';
    try { await api.put(`/admin/projects/${project._id}/moderation`, { moderationStatus }); setRows((items) => items.map((item) => item._id === project._id ? { ...item, moderationStatus } : item)); }
    catch (requestError) { setError(getMessage(requestError)); }
  }
  async function resolveReport(report, status) {
    try { await api.put(`/admin/reports/${report._id}`, { status }); setRows((items) => items.map((item) => item._id === report._id ? { ...item, status } : item)); setNotice(status === 'reviewed' ? 'Report reviewed and content moderated.' : 'Report dismissed.'); }
    catch (requestError) { setError(getMessage(requestError)); }
  }

  return <div className="page-stack"><div className="page-heading-row"><div><span className="eyebrow">PLATFORM OPERATIONS</span><h1>Admin panel</h1><p>Review platform health, accounts, projects, and reported content.</p></div><Shield size={19} /></div><div className="admin-tabs">{[['overview', 'Overview'], ['users', 'Users'], ['projects', 'Projects'], ['reports', 'Reports']].map(([value, label]) => <button key={value} className={section === value ? 'admin-tab admin-tab-active' : 'admin-tab'} onClick={() => setSection(value)}>{label}</button>)}</div>{error && <div className="form-alert form-alert-error">{error}</div>}{notice && <div className="form-alert">{notice}</div>}{loading ? <LoadingState label="Loading administration data…" /> : section === 'overview' ? <><div className="metrics-grid admin-metrics">{Object.entries(stats || {}).map(([key, value]) => <article className="metric-card" key={key}><div className="metric-icon"><BarChart3 size={16} /></div><strong>{value}</strong><span>{key.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)}</span></article>)}</div><p className="admin-security-note"><Shield size={15} /> Admin access is enforced by the API for every management action.</p></> : section === 'users' ? rows.length ? <section className="panel admin-table">{rows.map((user) => <div className="admin-row" key={user._id}><span className="avatar avatar-small">{user.fullName?.[0]}</span><span className="admin-row-main"><strong>{user.fullName} <small>@{user.username}</small></strong><small>{user.email} · {user.role}</small></span><span className={user.suspendedAt ? 'status-badge status-hidden' : 'status-badge'}>{user.suspendedAt ? 'Suspended' : 'Active'}</span>{user.role !== 'admin' && <button className="button button-quiet" onClick={() => suspend(user, !user.suspendedAt)}>{user.suspendedAt ? <Eye size={14} /> : <EyeOff size={14} />}{user.suspendedAt ? 'Restore' : 'Suspend'}</button>}</div>)}</section> : <EmptyState title="No users found" description="Users will appear here after registration." /> : section === 'projects' ? rows.length ? <section className="panel admin-table">{rows.map((project) => <div className="admin-row" key={project._id}><span className="metric-icon"><Users size={15} /></span><span className="admin-row-main"><strong>{project.title}</strong><small>{project.owner?.username} · {project.status}</small></span><span className={project.moderationStatus === 'hidden' ? 'status-badge status-hidden' : 'status-badge'}>{project.moderationStatus}</span><button className="button button-quiet" onClick={() => moderate(project)}>{project.moderationStatus === 'hidden' ? <Eye size={14} /> : <EyeOff size={14} />}{project.moderationStatus === 'hidden' ? 'Restore' : 'Hide'}</button></div>)}</section> : <EmptyState title="No projects found" description="Projects will appear here for moderation." /> : rows.length ? <section className="panel admin-table">{rows.map((report) => <div className="report-row" key={report._id}><span className="metric-icon"><Flag size={15} /></span><div className="admin-row-main"><strong>{report.targetType} report <small>· {report.status}</small></strong><p>{report.reason}</p><small>Reported by @{report.reporter?.username} · {new Date(report.createdAt).toLocaleDateString()}</small>{report.target?.title && <small>Item: {report.target.title}</small>}</div>{report.status === 'open' && <div className="request-actions"><button className="button button-quiet" onClick={() => resolveReport(report, 'dismissed')}>Dismiss</button><button className="button" onClick={() => resolveReport(report, 'reviewed')}>Review & hide</button></div>}</div>)}</section> : <EmptyState title="No reports to review" description="Reported posts, projects, and snippets appear here." />}</div>;
}
