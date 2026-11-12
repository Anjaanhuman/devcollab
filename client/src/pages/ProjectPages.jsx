import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, Check, ChevronDown, Code2, ExternalLink, Flag, FolderKanban, Plus, Search, Send, Settings2, Users, X } from 'lucide-react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import api, { getMessage } from '../services/api.js';
import { EmptyState, ErrorState, LoadingState } from '../components/common/StateView.jsx';

const idOf = (value) => String(value?._id ?? value?.id ?? value ?? '');
const isMember = (project, userId) => idOf(project.owner) === idOf(userId) || project.members?.some((member) => idOf(member.user) === idOf(userId));
const canManage = (project, userId, userRole) => userRole === 'admin' || idOf(project.owner) === idOf(userId) || project.members?.some((member) => idOf(member.user) === idOf(userId) && ['Owner', 'Team Leader'].includes(member.role));

function ProjectCard({ project, onRefresh }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const member = user && isMember(project, user.id);
  const ownerName = project.owner?.fullName || project.owner?.username || 'DEVCOLLAB member';

  async function join() {
    if (!user) return navigate('/register');
    setBusy(true); setNotice('');
    try { await api.post(`/projects/${project._id}/join`, { message: '' }); setNotice('Request sent'); }
    catch (error) { setNotice(getMessage(error)); }
    finally { setBusy(false); onRefresh?.(); }
  }

  async function reportProject() {
    if (!user) return navigate('/login');
    const reason = window.prompt('Briefly explain why this project should be reviewed:');
    if (!reason) return;
    try {
      await api.post('/reports', { targetType: 'Project', target: project._id, reason });
      setNotice('Report submitted for review.');
    } catch (error) { setNotice(getMessage(error)); }
  }

  return <article className="project-card"><div className="project-card-top"><span className="status-badge">{project.status}</span><span className="visibility-label">{project.visibility}</span></div><Link className="project-card-title" to={user ? `/app/projects/${project._id}` : `/projects/${project._id}`}><h2>{project.title}</h2></Link><p>{project.description}</p><div className="project-tags">{(project.requiredSkills || []).slice(0, 4).map((tag) => <span key={tag}>{tag}</span>)}</div><div className="project-card-bottom"><Link className="project-owner" to={`/developers/${project.owner?._id}`}><span className="avatar avatar-tiny">{ownerName[0]?.toUpperCase()}</span>{ownerName}</Link><span className="project-members"><Users size={13} /> {project.members?.length || 1}/{project.maxTeamSize}</span></div>{notice && <div className="inline-notice">{notice}</div>}<div className="project-card-actions"><Link className="text-button" to={user ? `/app/projects/${project._id}` : `/projects/${project._id}`}>View project <ArrowRight size={13} /></Link>{user && idOf(project.owner) !== idOf(user.id) && <button className="icon-button" onClick={reportProject} aria-label={`Report ${project.title}`} title="Report project"><Flag size={13} /></button>}{!member && project.visibility === 'public' && <button className="button button-quiet" onClick={join} disabled={busy}>{busy ? 'Sending…' : 'Request to join'} <Send size={13} /></button>}</div></article>;
}

function ProjectForm({ project, onCancel, onCreated }) {
  const [form, setForm] = useState(() => project ? {
    title: project.title,
    description: project.description,
    category: project.category || 'General',
    difficulty: project.difficulty || 'Beginner',
    maxTeamSize: project.maxTeamSize || 5,
    visibility: project.visibility || 'public',
    status: project.status || 'Planning',
    requiredSkills: project.requiredSkills?.join(', ') || '',
    techStack: project.techStack?.join(', ') || '',
    githubRepo: project.githubRepo || '',
    deadline: project.deadline ? new Date(project.deadline).toISOString().slice(0, 10) : '',
  } : { title: '', description: '', category: 'General', difficulty: 'Beginner', maxTeamSize: 5, visibility: 'public', status: 'Planning', requiredSkills: '', techStack: '', githubRepo: '', deadline: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  function update(event) { setForm((current) => ({ ...current, [event.target.name]: event.target.value })); }

  async function importGithub() {
    if (!form.githubRepo.trim()) return setError('Enter a GitHub repository first.');
    setBusy(true); setError('');
    try {
      const { data } = await api.get('/projects/github/metadata', { params: { repo: form.githubRepo } });
      const repo = data.data;
      const topics = [...new Set([...(form.techStack.split(',').map((value) => value.trim()).filter(Boolean)), repo.language, ...(repo.topics || [])].filter(Boolean))];
      setForm((current) => ({ ...current, title: current.title || repo.fullName.split('/')[1], description: current.description || repo.description || '', githubRepo: repo.url, techStack: topics.join(', ') }));
    } catch (requestError) { setError(getMessage(requestError)); }
    finally { setBusy(false); }
  }

  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const payload = { ...form, maxTeamSize: Number(form.maxTeamSize), requiredSkills: form.requiredSkills.split(',').map((x) => x.trim()).filter(Boolean), techStack: form.techStack.split(',').map((x) => x.trim()).filter(Boolean), deadline: form.deadline || null };
      const response = project ? await api.put(`/projects/${project._id}`, payload) : await api.post('/projects', payload);
      onCreated(response.data.data);
    } catch (requestError) { setError(getMessage(requestError)); }
    finally { setBusy(false); }
  }
  return <form className="panel project-form" onSubmit={submit}>
    <div className="panel-heading"><div><span className="eyebrow">{project ? 'PROJECT SETTINGS' : 'START WITH AN IDEA'}</span><h2>{project ? 'Edit project' : 'Create a project'}</h2></div><button type="button" className="icon-button" onClick={onCancel} aria-label="Close form"><X size={16} /></button></div>
    <div className="form-grid">
      <label className="form-span-two">Project title<input name="title" value={form.title} onChange={update} minLength={3} maxLength={120} required /></label>
      <label className="form-span-two">Description<textarea name="description" value={form.description} onChange={update} minLength={20} maxLength={5000} rows={3} required /></label>
      <label>Category<input name="category" value={form.category} onChange={update} maxLength={60} /></label>
      <label>Difficulty<select name="difficulty" value={form.difficulty} onChange={update}><option>Beginner</option><option>Intermediate</option><option>Advanced</option></select></label>
      <label>Team size<input name="maxTeamSize" type="number" min="1" max="50" value={form.maxTeamSize} onChange={update} /></label>
      <label>Deadline<input name="deadline" type="date" value={form.deadline} onChange={update} /></label>
      <label className="form-span-two">Required skills <small>Comma separated</small><input name="requiredSkills" value={form.requiredSkills} onChange={update} placeholder="React, Node.js, UI design" /></label>
      <label className="form-span-two">Tech stack <small>Comma separated</small><input name="techStack" value={form.techStack} onChange={update} placeholder="Vite, Express, MongoDB" /></label>
      <label className="form-span-two">GitHub repository <small>Optional · repository URL or owner/name</small><span className="github-repo-row"><input name="githubRepo" value={form.githubRepo} onChange={update} placeholder="https://github.com/owner/repository" /><button type="button" className="button button-quiet" onClick={importGithub} disabled={busy}><Code2 size={14} /> Import details</button></span></label>
      {project && <label>Project status<select name="status" value={form.status} onChange={update}><option>Planning</option><option>Active</option><option>Completed</option><option>Archived</option></select></label>}
      <label>Visibility<select name="visibility" value={form.visibility} onChange={update}><option value="public">Public</option><option value="private">Private</option></select></label>
    </div>
    {error && <div className="form-alert form-alert-error">{error}</div>}
    <div className="form-actions"><button type="button" className="button button-quiet" onClick={onCancel}>Cancel</button><button className="button" disabled={busy}>{busy ? 'Saving…' : project ? 'Save changes' : 'Create project'} <ArrowRight size={14} /></button></div>
  </form>;
}

export function ProjectsPage() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const mine = location.pathname.endsWith('/mine');
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [query, setQuery] = useState(params.get('q') || '');
  const [skill, setSkill] = useState('');
  const [tech, setTech] = useState('');

  async function load() {
    setLoading(true); setError('');
    try {
      const response = await api.get('/projects', { params: { q: params.get('q') || undefined, skill: skill || undefined, tech: tech || undefined, limit: 60 } });
      setProjects(response.data.data);
    } catch (requestError) { setError(getMessage(requestError)); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    const timer = window.setTimeout(load, 240);
    return () => window.clearTimeout(timer);
  }, [params, skill, tech]);
  const visibleProjects = useMemo(() => mine ? projects.filter((project) => isMember(project, user?.id)) : projects, [projects, mine, user?.id]);
  function search(event) { event.preventDefault(); setParams(query ? { q: query } : {}); }
  function created(project) { setProjects((current) => [project, ...current]); setShowCreate(false); navigate(`/app/projects/${project._id}`); }

  return <div className="page-stack"><div className="page-heading-row"><div><span className="eyebrow">{mine ? 'YOUR WORK' : 'FIND YOUR NEXT TEAM'}</span><h1>{mine ? 'My projects' : 'Explore projects'}</h1><p>{mine ? 'The projects you own and teams you have joined.' : 'Find projects to join, or create a place for your next idea.'}</p></div>{user && <button className="button" onClick={() => setShowCreate((visible) => !visible)}><Plus size={15} /> New project</button>}</div>
    {showCreate && <ProjectForm onCancel={() => setShowCreate(false)} onCreated={created} />}
    {!mine && <form className="filter-bar" onSubmit={search}><Search size={15} /><input aria-label="Search projects" placeholder="Search projects, skills, or tech…" value={query} onChange={(event) => setQuery(event.target.value)} /><input aria-label="Filter by skill" placeholder="Filter skill" value={skill} onChange={(event) => setSkill(event.target.value)} /><input aria-label="Filter by technology" placeholder="Filter tech" value={tech} onChange={(event) => setTech(event.target.value)} /><button className="button button-quiet">Search</button></form>}
    {loading ? <LoadingState label="Loading projects…" /> : error ? <ErrorState message={error} onRetry={load} /> : visibleProjects.length ? <div className="project-grid">{visibleProjects.map((project) => <ProjectCard key={project._id} project={project} onRefresh={load} />)}</div> : <EmptyState title={mine ? 'No projects yet' : 'No projects found'} description={mine ? 'Create a project or request to join a public team.' : 'Try a different search, or start a new project.'} action={user ? <button className="button" onClick={() => setShowCreate(true)}><Plus size={14} /> Create project</button> : <Link className="button" to="/register">Join DEVCOLLAB</Link>} />}
  </div>;
}

export function ProjectDetailPage() {
  const { projectId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [requests, setRequests] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  async function load() {
    setLoading(true); setError('');
    try {
      const response = await api.get(`/projects/${projectId}`);
      setProject(response.data.data);
      const canManageThis = canManage(response.data.data, user?.id, user?.role);
      const results = await Promise.allSettled([
        isMember(response.data.data, user?.id) ? api.get(`/tasks/project/${projectId}`, { params: { limit: 100 } }) : Promise.resolve({ data: { data: [] } }),
        canManageThis ? api.get(`/projects/${projectId}/requests`) : Promise.resolve({ data: { data: [] } }),
        canManageThis ? api.get('/users', { params: { limit: 100 } }) : Promise.resolve({ data: { data: [] } }),
      ]);
      setTasks(results[0].status === 'fulfilled' ? results[0].value.data.data : []);
      setRequests(results[1].status === 'fulfilled' ? results[1].value.data.data : []);
      setPeople(results[2].status === 'fulfilled' ? results[2].value.data.data : []);
    } catch (requestError) { setError(getMessage(requestError)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [projectId, user?.id]);
  if (loading) return <LoadingState label="Loading project…" />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!project) return <EmptyState title="Project not found" description="This project may be private, removed, or unavailable." action={<Link className="button" to={user ? '/app/projects' : '/projects'}>Back to projects</Link>} />;

  const member = isMember(project, user?.id);
  const manager = canManage(project, user?.id, user?.role);
  const owner = idOf(project.owner);
  const canDelete = owner === idOf(user?.id) || user?.role === 'admin';
  async function join() {
    if (!user) return navigate('/register');
    setBusy(true); setNotice('');
    try { await api.post(`/projects/${projectId}/join`, { message: '' }); setNotice('Your join request was sent.'); }
    catch (requestError) { setNotice(getMessage(requestError)); }
    finally { setBusy(false); }
  }
  async function decide(requestId, status) {
    try { await api.put(`/requests/${requestId}`, { status }); setNotice(`Request ${status}.`); await load(); }
    catch (requestError) { setNotice(getMessage(requestError)); }
  }
  async function invite(event) {
    event.preventDefault();
    const userToInvite = people.find((person) => person.username.toLowerCase() === query.trim().replace(/^@/, '').toLowerCase());
    if (!userToInvite) return setNotice('Choose a developer from the directory before inviting.');
    try { await api.post(`/projects/${projectId}/invites`, { userId: userToInvite.id }); setNotice(`@${userToInvite.username} joined the team.`); setQuery(''); await load(); }
    catch (requestError) { setNotice(getMessage(requestError)); }
  }
  async function removeMember(userId) {
    if (!window.confirm('Remove this developer from the project?')) return;
    try { await api.put(`/projects/${projectId}/members/${userId}`, { action: 'remove' }); await load(); }
    catch (requestError) { setNotice(getMessage(requestError)); }
  }
  async function changeRole(userId, role) {
    try { await api.put(`/projects/${projectId}/members/${userId}`, { action: 'setRole', role }); await load(); }
    catch (requestError) { setNotice(getMessage(requestError)); }
  }
  async function deleteProject() {
    if (!window.confirm('Delete this project and its tasks, messages, requests, and notifications?')) return;
    try { await api.delete(`/projects/${projectId}`); navigate('/app/projects'); }
    catch (requestError) { setNotice(getMessage(requestError)); }
  }

  return <div className="page-stack"><Link to={user ? '/app/projects' : '/projects'} className="back-link"><ArrowLeft size={14} /> Projects</Link><section className="project-detail-hero panel"><div className="project-card-top"><span className="status-badge">{project.status}</span><span className="visibility-label">{project.visibility}</span></div><h1>{project.title}</h1><p>{project.description}</p><div className="project-tags">{[...(project.requiredSkills || []), ...(project.techStack || [])].slice(0, 12).map((tag) => <span key={tag}>{tag}</span>)}</div><div className="detail-meta"><span><Users size={14} /> {project.members?.length || 1} / {project.maxTeamSize} members</span><span><CalendarDays size={14} /> {project.deadline ? new Date(project.deadline).toLocaleDateString() : 'No deadline'}</span>{project.githubRepo && <a href={project.githubRepo.startsWith('http') ? project.githubRepo : `https://github.com/${project.githubRepo}`} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Repository</a>}</div><div className="detail-actions">{!member && project.visibility === 'public' && <button className="button" onClick={join} disabled={busy}>{busy ? 'Sending…' : 'Request to join'} <Send size={14} /></button>}{member && <Link className="button button-quiet" to={`/app/tasks?project=${projectId}`}>Open task board <ArrowRight size={14} /></Link>}{manager && <button className="button button-quiet" onClick={() => setShowEdit((visible) => !visible)}><Settings2 size={14} /> Edit project</button>}{canDelete && <button className="button button-danger" onClick={deleteProject}>Delete project</button>}</div></section>
    {member && <Link className="workspace-launch panel" to={`/workspace/${projectId}`}><span><Code2 size={18} /></span><div><strong>Open project workspace</strong><small>Edit files, collaborate with your team, and manage project tasks.</small></div><ArrowRight size={16} /></Link>}
    {showEdit && <ProjectForm project={project} onCancel={() => setShowEdit(false)} onCreated={(updated) => { setProject(updated); setShowEdit(false); setNotice("Project updated."); }} />}
    {notice && <div className="form-alert" role="status">{notice}</div>}
    <div className="detail-grid"><section className="panel"><div className="panel-heading"><div><span className="eyebrow">THE TEAM</span><h2>Project members</h2></div><Users size={16} /></div><div className="member-list">{project.members?.map((entry) => <div className="member-row" key={idOf(entry.user)}><span className="avatar avatar-small">{entry.user?.avatarUrl ? <img src={entry.user.avatarUrl} alt="" /> : entry.user?.fullName?.[0] || 'D'}</span><Link className="member-name" to={`/developers/${idOf(entry.user)}`}><strong>{entry.user?.fullName || entry.user?.username}</strong><small>@{entry.user?.username}</small></Link>{manager && idOf(entry.user) !== owner ? <><select value={entry.role} onChange={(event) => changeRole(idOf(entry.user), event.target.value)} aria-label={`Role for ${entry.user?.username}`}><option>Team Leader</option><option>Developer</option><option>Contributor</option></select><button className="icon-button" onClick={() => removeMember(idOf(entry.user))} aria-label={`Remove ${entry.user?.username}`}><X size={14} /></button></> : <span className="member-role">{entry.role}</span>}</div>)}</div>{manager && <form className="invite-form" onSubmit={invite}><input list="developer-directory" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Invite by username" aria-label="Invite by username" /><datalist id="developer-directory">{people.filter((person) => !isMember(project, person.id)).map((person) => <option key={person.id} value={person.username}>{person.fullName}</option>)}</datalist><button className="button button-quiet">Invite <Plus size={13} /></button></form>}</section>
      <section className="panel"><div className="panel-heading"><div><span className="eyebrow">PROJECT WORK</span><h2>Current tasks</h2></div><Link className="panel-link" to={`/app/tasks?project=${projectId}`}>View board <ArrowRight size={13} /></Link></div>{member ? tasks.slice(0, 5).length ? <div className="task-preview-list">{tasks.slice(0, 5).map((task) => <div key={task._id} className="task-preview"><span className={`task-state task-state-${task.status.replaceAll(' ', '-').toLowerCase()}`}><Check size={12} /></span><span><strong>{task.title}</strong><small>{task.status} · {task.priority}</small></span></div>)}</div> : <EmptyState title="No tasks yet" description="Create the first task for this project." action={<Link className="button button-quiet" to={`/app/tasks?project=${projectId}`}>Open task board</Link>} /> : <EmptyState title="Join the team to view tasks" description="Project tasks are visible to team members." />}</section>
      {manager && <section className="panel join-request-panel"><div className="panel-heading"><div><span className="eyebrow">GROW THE TEAM</span><h2>Join requests</h2></div><span className="count-badge">{requests.length}</span></div>{requests.length ? requests.map((request) => <div className="request-row" key={request._id}><span className="avatar avatar-small">{request.requester?.fullName?.[0]}</span><div className="request-copy"><strong>{request.requester?.fullName} <small>@{request.requester?.username}</small></strong><p>{request.message || 'Would like to collaborate on this project.'}</p></div><div className="request-actions"><button className="button button-quiet" onClick={() => decide(request._id, 'rejected')}>Decline</button><button className="button" onClick={() => decide(request._id, 'accepted')}>Accept</button></div></div>) : <EmptyState title="No pending requests" description="New join requests will appear here." />}</section>}
    </div></div>;
}

export function TeamsPage() {
  const { user } = useAuth();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  async function load() {
    setLoading(true); setError('');
    try { const { data } = await api.get('/projects', { params: { limit: 100 } }); setProjects(data.data.filter((project) => isMember(project, user?.id))); }
    catch (requestError) { setError(getMessage(requestError)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [user?.id]);
  return <div className="page-stack"><div className="page-heading-row"><div><span className="eyebrow">TEAM COLLABORATION</span><h1>Your teams</h1><p>Keep track of the people you build with.</p></div><Link className="button" to="/app/projects">Find a team <ArrowRight size={14} /></Link></div>{loading ? <LoadingState label="Loading teams…" /> : error ? <ErrorState message={error} onRetry={load} /> : projects.length ? <div className="team-grid">{projects.map((project) => <Link className="team-card panel" to={`/app/projects/${project._id}`} key={project._id}><div className="team-card-icon"><FolderKanban size={18} /></div><div className="team-card-copy"><strong>{project.title}</strong><small>{project.status} · {project.members?.length || 1} members</small></div><ArrowRight size={15} /></Link>)}</div> : <EmptyState title="No teams yet" description="Create a project or request to join a public one." action={<Link className="button" to="/app/projects">Explore projects</Link>} />}</div>;
}
