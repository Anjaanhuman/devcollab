import { useEffect, useState } from 'react';
import { Activity, ArrowRight, CheckCircle2, CircleDot, FolderKanban, ListTodo, MessageSquare, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import api, { getMessage } from '../services/api.js';
import { EmptyState, ErrorState, LoadingState } from '../components/common/StateView.jsx';

const metricCards = [
  ['createdProjects', 'Projects created', FolderKanban],
  ['joinedProjects', 'Projects joined', Users],
  ['activeProjects', 'Active projects', CircleDot],
  ['completedProjects', 'Projects completed', CheckCircle2],
  ['pendingTasks', 'Open tasks', ListTodo],
  ['completedTasks', 'Tasks completed', CheckCircle2],
];

export default function DashboardPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true); setError('');
    try { const response = await api.get('/dashboard'); setData(response.data.data); }
    catch (requestError) { setError(getMessage(requestError)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  if (loading) return <LoadingState label="Loading your workspace…" />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <EmptyState title="Your workspace is ready" description="Create or join a project to see your activity here." action={<Link className="button" to="/app/projects">Explore projects <ArrowRight size={14} /></Link>} />;

  return (
    <div className="page-stack">
      <div className="page-heading-row"><div><span className="eyebrow">YOUR WORKSPACE</span><h1>Good work starts here.</h1><p>Projects, tasks, and people—together in one place.</p></div><Link to="/app/projects" className="button">Explore projects <ArrowRight size={14} /></Link></div>
      <section className="metrics-grid" aria-label="Workspace metrics">
        {metricCards.map(([key, label, Icon]) => <article className="metric-card" key={key}><div className="metric-icon"><Icon size={17} /></div><strong>{data.metrics[key] ?? 0}</strong><span>{label}</span></article>)}
      </section>
      <section className="dashboard-lower-grid">
        <article className="panel activity-panel"><div className="panel-heading"><div><span className="eyebrow">KEEP THE MOMENTUM</span><h2>Recent activity</h2></div><Activity size={17} /></div>
          {data.recentActivity?.length ? <div className="activity-list">{data.recentActivity.map((item) => <div className="activity-row" key={`${item.kind}-${item.id}`}><span className={`activity-kind activity-${item.kind}`}>{item.kind === 'task' ? <ListTodo size={14} /> : <FolderKanban size={14} />}</span><span className="activity-copy"><strong>{item.title}</strong><small>{item.detail}</small></span><time>{new Date(item.at).toLocaleDateString()}</time></div>)}</div> : <EmptyState title="Nothing to report yet" description="Project and task activity will appear here." />}
        </article>
        <aside className="dashboard-side-stack">
          <article className="panel progress-panel"><div className="panel-heading"><div><span className="eyebrow">TASK PROGRESS</span><h2>Keep moving</h2></div><CheckCircle2 size={17} /></div><div className="progress-stat"><strong>{data.metrics.completionPercent ?? 0}%</strong><span>of your assigned and created tasks are complete</span></div><div className="progress-track"><i style={{ width: `${data.metrics.completionPercent ?? 0}%` }} /></div><Link className="panel-link" to="/app/tasks">Open task board <ArrowRight size={13} /></Link></article>
          <article className="panel inbox-panel"><div className="panel-heading"><div><span className="eyebrow">TEAM INBOX</span><h2>Unread messages</h2></div><span className="count-badge">{data.metrics.unreadMessages || 0}</span></div>{data.unreadMessagePreview?.length ? <div className="message-preview-list">{data.unreadMessagePreview.map((message) => <Link className="message-preview-row" to="/app/messages" key={message._id}><span className="avatar avatar-small">{message.sender?.avatarUrl ? <img src={message.sender.avatarUrl} alt="" /> : message.sender?.fullName?.[0]?.toUpperCase()}</span><span><strong>{message.sender?.fullName || message.sender?.username || 'Developer'}{message.project?.title ? <small> · {message.project.title}</small> : ''}</strong><small>{message.body}</small></span><time>{new Date(message.createdAt).toLocaleDateString()}</time></Link>)}</div> : <p className="inbox-empty">No unread messages. Your inbox is up to date.</p>}<Link className="panel-link" to="/app/messages">Open messages <ArrowRight size={13} /></Link></article>
          <article className="panel quick-panel"><span className="eyebrow">QUICK LINKS</span><Link to="/app/teams"><Users size={15} /> Your teams <ArrowRight size={13} /></Link><Link to="/app/community"><Activity size={15} /> Community <ArrowRight size={13} /></Link></article>
        </aside>
      </section>
    </div>
  );
}
