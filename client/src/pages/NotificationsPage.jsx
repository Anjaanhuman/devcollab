import { useEffect, useState } from 'react';
import { Bell, Check, CheckCheck, ExternalLink, MessageSquare, Users, ListTodo, FolderKanban, MessageCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import api, { getMessage } from '../services/api.js';
import { EmptyState, ErrorState, LoadingState } from '../components/common/StateView.jsx';

const iconFor = (type) => type.includes('task') ? ListTodo : type.includes('request') || type.includes('invite') ? Users : type === 'message' ? MessageSquare : type === 'post_reply' ? MessageCircle : FolderKanban;
const hrefFor = (item) => item.project ? `/app/projects/${item.project._id}` : item.task?.project ? `/app/projects/${item.task.project}` : item.post ? `/community/${item.post}` : '/app/notifications';

export default function NotificationsPage() {
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true); setError('');
    try { const { data } = await api.get('/notifications', { params: { limit: 100 } }); setItems(data.data); setUnread(data.unreadCount); }
    catch (requestError) { setError(getMessage(requestError)); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    load();
    const refresh = () => load();
    window.addEventListener('devcollab:notification-new', refresh);
    return () => window.removeEventListener('devcollab:notification-new', refresh);
  }, []);

  async function markOne(item) {
    if (item.readAt) return;
    try { await api.put(`/notifications/${item._id}/read`); setItems((current) => current.map((entry) => entry._id === item._id ? { ...entry, readAt: new Date().toISOString() } : entry)); setUnread((count) => Math.max(0, count - 1)); window.dispatchEvent(new Event('devcollab:notifications-changed')); }
    catch (requestError) { setError(getMessage(requestError)); }
  }
  async function markAll() {
    try { await api.put('/notifications/read-all'); setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt || new Date().toISOString() }))); setUnread(0); window.dispatchEvent(new Event('devcollab:notifications-changed')); }
    catch (requestError) { setError(getMessage(requestError)); }
  }

  return <div className="page-stack"><div className="page-heading-row"><div><span className="eyebrow">STAY IN THE LOOP</span><h1>Notifications</h1><p>{unread ? `${unread} unread update${unread === 1 ? '' : 's'} for your workspace.` : 'You are all caught up.'}</p></div>{unread > 0 && <button className="button button-quiet" onClick={markAll}><CheckCheck size={15} /> Mark all read</button>}</div>{error && <div className="form-alert form-alert-error">{error}</div>}{loading ? <LoadingState label="Loading notifications…" /> : items.length ? <section className="panel notification-list">{items.map((item) => { const Icon = iconFor(item.type); return <Link className={`notification-row${item.readAt ? '' : ' notification-unread'}`} to={hrefFor(item)} key={item._id} onClick={() => markOne(item)}><span className="notification-icon"><Icon size={16} /></span><span className="notification-copy"><strong>{item.message}</strong><small>{item.actor?.fullName ? `${item.actor.fullName} · ` : ''}{new Date(item.createdAt).toLocaleString()}</small>{item.project?.title && <small>Project: {item.project.title}</small>}</span>{!item.readAt && <span className="unread-mark" />}</Link>; })}</section> : <EmptyState title="No notifications yet" description="Project requests, assignments, replies, and messages will appear here." action={<Link className="button button-quiet" to="/app/projects"><Bell size={14} /> Explore projects</Link>} />}</div>;
}
