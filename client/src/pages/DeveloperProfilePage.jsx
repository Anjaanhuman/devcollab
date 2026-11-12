import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowUpRight, BriefcaseBusiness, Code2, Globe2, Users } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import api, { getMessage } from '../services/api.js';
import { EmptyState, ErrorState, LoadingState } from '../components/common/StateView.jsx';

export default function DeveloperProfilePage() {
  const { userId } = useParams();
  const [profile, setProfile] = useState(null);
  const [section, setSection] = useState('created');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get(`/users/${userId}`);
      setProfile(data.data);
    } catch (requestError) {
      setError(getMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [userId]);

  if (loading) return <main className="public-content page-width"><LoadingState label="Loading developer profile…" /></main>;
  if (error || !profile) return <main className="public-content page-width"><ErrorState message={error || 'Developer profile not found.'} onRetry={load} /></main>;

  const { user, createdProjects = [], joinedProjects = [] } = profile;
  const projects = section === 'created' ? createdProjects : joinedProjects;
  const social = user.socialLinks || {};

  return <main className="public-content page-width page-stack">
    <Link className="back-link" to="/projects"><ArrowLeft size={14} /> Explore projects</Link>
    <section className="panel public-profile-hero">
      <span className="avatar">{user.avatarUrl ? <img src={user.avatarUrl} alt={`${user.fullName}'s avatar`} /> : user.fullName?.[0]?.toUpperCase()}</span>
      <div className="public-profile-copy">
        <span className="eyebrow">DEVELOPER PROFILE · {user.experienceLevel}</span>
        <h1>{user.fullName}</h1>
        <p>@{user.username}{user.bio ? ` · ${user.bio}` : ''}</p>
        <div className="profile-links">
          {social.github && <a href={social.github} target="_blank" rel="noreferrer"><Code2 size={13} /> GitHub <ArrowUpRight size={11} /></a>}
          {social.linkedin && <a href={social.linkedin} target="_blank" rel="noreferrer"><BriefcaseBusiness size={13} /> LinkedIn <ArrowUpRight size={11} /></a>}
          {social.portfolio && <a href={social.portfolio} target="_blank" rel="noreferrer"><Globe2 size={13} /> Portfolio <ArrowUpRight size={11} /></a>}
        </div>
      </div>
    </section>

    {(user.skills?.length > 0 || user.languages?.length > 0 || user.techStack?.length > 0) && <section className="panel profile-skills">
      <div className="panel-heading"><div><span className="eyebrow">WHAT THEY WORK WITH</span><h2>Skills & tools</h2></div><Code2 size={16} /></div>
      {user.skills?.length > 0 && <div className="profile-skill-row"><strong>Skills</strong><div className="project-tags">{user.skills.map((skill) => <span key={skill}>{skill}</span>)}</div></div>}
      {user.languages?.length > 0 && <div className="profile-skill-row"><strong>Languages</strong><div className="project-tags">{user.languages.map((language) => <span key={language}>{language}</span>)}</div></div>}
      {user.techStack?.length > 0 && <div className="profile-skill-row"><strong>Tech stack</strong><div className="project-tags">{user.techStack.map((tech) => <span key={tech}>{tech}</span>)}</div></div>}
    </section>}

    <section className="page-stack profile-projects">
      <div className="profile-tabs" role="tablist" aria-label="Developer projects">
        <button className={section === 'created' ? 'profile-tab profile-tab-active' : 'profile-tab'} onClick={() => setSection('created')} role="tab" aria-selected={section === 'created'}><BriefcaseBusiness size={13} /> Created <span>{createdProjects.length}</span></button>
        <button className={section === 'joined' ? 'profile-tab profile-tab-active' : 'profile-tab'} onClick={() => setSection('joined')} role="tab" aria-selected={section === 'joined'}><Users size={13} /> Joined <span>{joinedProjects.length}</span></button>
      </div>
      {projects.length ? <div className="project-grid">{projects.map((project) => <article className="project-card" key={project._id}>
        <div className="project-card-top"><span className="status-badge">{project.status}</span><span className="visibility-label">Public</span></div>
        <Link className="project-card-title" to={`/projects/${project._id}`}><h2>{project.title}</h2></Link>
        <div className="project-card-actions"><span className="project-owner">Project {section === 'created' ? 'owner' : 'member'}</span><Link className="text-button" to={`/projects/${project._id}`}>View project <ArrowUpRight size={13} /></Link></div>
      </article>)}</div> : <EmptyState title={section === 'created' ? 'No public projects created' : 'No public projects joined'} description="Public projects will appear here when this developer starts or joins a team." />}
    </section>
  </main>;
}
