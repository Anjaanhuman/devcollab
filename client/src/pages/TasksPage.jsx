import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CalendarDays, Check, ChevronDown, Plus, Trash2 } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import api, { getMessage } from '../services/api.js';
import { EmptyState, ErrorState, LoadingState } from '../components/common/StateView.jsx';

const columns = ['To Do', 'In Progress', 'In Review', 'Completed'];
const priorities = ['Low', 'Medium', 'High', 'Critical'];
const idOf = (value) => String(value?._id ?? value?.id ?? value ?? '');
const memberOf = (project, id) => idOf(project.owner) === idOf(id) || project.members?.some((member) => idOf(member.user) === idOf(id));

export default function TasksPage() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(params.get('project') || '');
  const [tasks, setTasks] = useState([]);
  const [progress, setProgress] = useState({ total: 0, completed: 0, percentage: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState({ priority: '', assignee: '' });
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', assignedTo: '', priority: 'Medium', deadline: '' });
  const [saving, setSaving] = useState(false);

  async function loadProjects() {
    setLoading(true); setError('');
    try {
      const { data } = await api.get('/projects', { params: { limit: 100 } });
      const mine = data.data.filter((project) => memberOf(project, user?.id));
      setProjects(mine);
      const requested = params.get('project');
      setProjectId((current) => mine.some((project) => project._id === current) ? current : (mine.find((project) => project._id === requested)?._id || mine[0]?._id || ''));
    } catch (requestError) { setError(getMessage(requestError)); }
    finally { setLoading(false); }
  }

  async function loadTasks() {
    if (!projectId) { setTasks([]); return; }
    setError('');
    try {
      const { data } = await api.get(`/tasks/project/${projectId}`, { params: { limit: 100, priority: query.priority || undefined, assignee: query.assignee || undefined } });
      setTasks(data.data); setProgress(data.progress);
    } catch (requestError) { setError(getMessage(requestError)); }
  }

  useEffect(() => { loadProjects(); }, [user?.id]);
  useEffect(() => { loadTasks(); }, [projectId, query.priority, query.assignee]);

  const selectedProject = projects.find((project) => project._id === projectId);
  const tasksByStatus = useMemo(() => Object.fromEntries(columns.map((status) => [status, tasks.filter((task) => task.status === status)])), [tasks]);

  async function createTask(event) {
    event.preventDefault(); if (!projectId) return;
    setSaving(true); setError('');
    try {
      const { data } = await api.post('/tasks', { ...form, project: projectId, assignedTo: form.assignedTo || null, deadline: form.deadline || null });
      setTasks((current) => [...current, data.data]); setShowCreate(false); setForm({ title: '', description: '', assignedTo: '', priority: 'Medium', deadline: '' });
      await loadTasks();
    } catch (requestError) { setError(getMessage(requestError)); }
    finally { setSaving(false); }
  }

  async function updateTask(task, changes) {
    const previous = tasks;
    setTasks((current) => current.map((item) => item._id === task._id ? { ...item, ...changes } : item));
    try { await api.put(`/tasks/${task._id}`, changes); await loadTasks(); }
    catch (requestError) { setTasks(previous); setError(getMessage(requestError)); }
  }

  async function deleteTask(task) {
    if (!window.confirm(`Delete “${task.title}”?`)) return;
    try { await api.delete(`/tasks/${task._id}`); setTasks((current) => current.filter((item) => item._id !== task._id)); await loadTasks(); }
    catch (requestError) { setError(getMessage(requestError)); }
  }

  if (loading) return <LoadingState label="Loading your project boards…" />;
  if (error && !selectedProject) return <ErrorState message={error} onRetry={loadProjects} />;

  return <div className="page-stack"><div className="page-heading-row"><div><span className="eyebrow">PLAN THE WORK</span><h1>Task board</h1><p>Move project work forward, one clear task at a time.</p></div><div className="task-header-controls"><label className="visually-hidden" htmlFor="task-project-select">Select project</label><select id="task-project-select" value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">Select project</option>{projects.map((project) => <option key={project._id} value={project._id}>{project.title}</option>)}</select>{selectedProject && <button className="button" onClick={() => setShowCreate((open) => !open)}><Plus size={15} /> New task</button>}</div></div>
    {error && <ErrorState message={error} onRetry={loadTasks} />}
    {!projects.length ? <EmptyState title="No project boards yet" description="Create a project or join a team before managing tasks." /> : !selectedProject ? <EmptyState title="Choose a project" description="Select a project to load its task board." /> : <>
      <div className="task-progress panel"><div><span className="eyebrow">{selectedProject.title.toUpperCase()}</span><strong>{progress.completed} / {progress.total} tasks complete</strong></div><div className="progress-track"><i style={{ width: `${progress.percentage}%` }} /></div><span className="task-progress-percent">{progress.percentage}%</span></div>
      {showCreate && <form className="panel task-create-form" onSubmit={createTask}><div className="panel-heading"><div><span className="eyebrow">ADD TO THE BOARD</span><h2>New task</h2></div></div><div className="form-grid"><label className="form-span-two">Title<input value={form.title} onChange={(event) => setForm((value) => ({ ...value, title: event.target.value }))} minLength={2} maxLength={180} required /></label><label className="form-span-two">Details<textarea rows={2} value={form.description} onChange={(event) => setForm((value) => ({ ...value, description: event.target.value }))} maxLength={3000} /></label><label>Priority<select value={form.priority} onChange={(event) => setForm((value) => ({ ...value, priority: event.target.value }))}>{priorities.map((priority) => <option key={priority}>{priority}</option>)}</select></label><label>Assignee<select value={form.assignedTo} onChange={(event) => setForm((value) => ({ ...value, assignedTo: event.target.value }))}><option value="">Unassigned</option>{selectedProject.members?.map((member) => <option key={idOf(member.user)} value={idOf(member.user)}>{member.user?.fullName || member.user?.username}</option>)}</select></label><label>Deadline<input type="date" value={form.deadline} onChange={(event) => setForm((value) => ({ ...value, deadline: event.target.value }))} /></label></div><div className="form-actions"><button type="button" className="button button-quiet" onClick={() => setShowCreate(false)}>Cancel</button><button className="button" disabled={saving}>{saving ? 'Saving…' : 'Create task'} <ArrowRight size={14} /></button></div></form>}
      <div className="task-filter-bar"><span><strong>{tasks.length}</strong> tasks</span><label>Priority<select value={query.priority} onChange={(event) => setQuery((value) => ({ ...value, priority: event.target.value }))}><option value="">All priorities</option>{priorities.map((priority) => <option key={priority}>{priority}</option>)}</select></label><label>Assignee<select value={query.assignee} onChange={(event) => setQuery((value) => ({ ...value, assignee: event.target.value }))}><option value="">Everyone</option><option value="me">Assigned to me</option></select></label></div>
      <div className="kanban-board">{columns.map((status) => <section className="kanban-column" key={status}><div className="kanban-heading"><span className={`column-mark column-${status.replaceAll(' ', '-').toLowerCase()}`} /><h2>{status}</h2><span>{tasksByStatus[status]?.length || 0}</span></div><div className="kanban-cards">{tasksByStatus[status]?.map((task) => <article className="task-card" key={task._id}><div className="task-card-meta"><span className={`priority-badge priority-${task.priority.toLowerCase()}`}>{task.priority}</span><button className="icon-button task-delete" onClick={() => deleteTask(task)} aria-label={`Delete ${task.title}`}><Trash2 size={13} /></button></div><h3>{task.title}</h3>{task.description && <p>{task.description}</p>}<div className="task-card-footer"><span>{task.assignedTo?.fullName || 'Unassigned'}</span>{task.deadline && <time><CalendarDays size={12} /> {new Date(task.deadline).toLocaleDateString()}</time>}</div><label className="task-status-select"><span className="visually-hidden">Move {task.title}</span><select value={task.status} onChange={(event) => updateTask(task, { status: event.target.value })}>{columns.map((column) => <option key={column}>{column}</option>)}</select><ChevronDown size={12} /></label></article>)}{!tasksByStatus[status]?.length && <div className="column-empty">No tasks in this stage</div>}</div></section>)}</div>
    </>}
  </div>;
}
