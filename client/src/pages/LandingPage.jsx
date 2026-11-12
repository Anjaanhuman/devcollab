import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';

const features = [
  { number: '01', title: 'Team Discovery', text: 'Find developers whose skills and interests fit the work you want to do.' },
  { number: '02', title: 'Project Management', text: 'Turn an idea into a clear plan, with milestones and progress in one place.' },
  { number: '03', title: 'Real-Time Messaging', text: 'Keep team conversations close to the projects and people they connect.' },
  { number: '04', title: 'Code Sharing', text: 'Save and share useful snippets with context your teammates can reuse.' },
  { number: '05', title: 'Developer Community', text: 'Ask questions, share what you have learned, and help others move forward.' },
  { number: '06', title: 'Role-Based Security', text: 'Give project members the right access for their role and responsibilities.' },
];

function BrandMark() {
  return <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>;
}

function ThemeIcon({ theme }) {
  return theme === 'dark'
    ? <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></svg>
    : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.4 15.1A8.5 8.5 0 0 1 8.9 3.6 8.5 8.5 0 1 0 20.4 15.1Z" /></svg>;
}

function WorkspacePreview() {
  return (
    <div className="workspace-card" aria-label="Preview of a DEVCOLLAB project board">
      <div className="workspace-top"><div className="window-dots"><i /><i /><i /></div><span>workspace / projects</span><span className="workspace-live"><i /> TEAM SPACE</span></div>
      <div className="workspace-body">
        <aside className="workspace-rail" aria-hidden="true"><b>d</b><i className="rail-active">⌂</i><i>▦</i><i>◷</i><i>⌘</i><span /><i>⚙</i></aside>
        <div className="project-pane">
          <div className="project-breadcrumb">WORKSPACE <span>/</span> PROJECT</div>
          <div className="project-title-row"><div><div className="project-kicker">PROJECT OVERVIEW <span className="project-tag">TEAM SPACE</span></div><h2>Project workspace</h2></div></div>
          <p className="project-summary">A shared space for your people, plan, and progress.</p>
          <div className="task-list">
            <div className="task"><span className="task-square" /><span>Define project goals</span><small>TO DO</small></div>
            <div className="task"><span className="task-square" /><span>Plan the first milestone</span><small>TO DO</small></div>
            <div className="task"><span className="task-square" /><span>Invite project teammates</span><small>TO DO</small></div>
            <div className="task"><span className="task-square" /><span>Share project context</span><small>TO DO</small></div>
          </div>
        </div>
      </div>
      <div className="workspace-caption"><span /> ONE TEAM, MOVING FORWARD</div>
    </div>
  );
}

function LandingPage() {
  const { user, loading } = useAuth();
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="app-shell" id="top">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="DEVCOLLAB home"><BrandMark /><span>DEV<span className="brand-light">COLLAB</span></span></a>
        <nav className="main-nav" aria-label="Main navigation">
          <a className="nav-active" href="#top">Home</a>
          <a href="#projects">Explore Projects</a>
          <Link to="/community">Community</Link>
          <Link to="/snippets">Code Sharing</Link>
        </nav>
        <div className="header-actions">
          <button className="theme-toggle" type="button" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} title="Toggle theme"><ThemeIcon theme={theme} /></button>
          {loading ? null : user ? <Link className="button button-small" to="/app/dashboard">Open workspace <span aria-hidden="true">↗</span></Link> : <><Link className="login-link" to="/login">Log In</Link><Link className="button button-small" to="/register">Get Started <span aria-hidden="true">↗</span></Link></>}
        </div>
        <Link className="mobile-join" to="/register">Join <span aria-hidden="true">↗</span></Link>
      </header>

      <main>
        <section className="hero page-width">
          <div className="hero-copy">
            <div className="eyebrow"><span className="status-dot" /> A workspace for people who build</div>
            <h1>Build Together.<br /><span className="heading-accent">Create Better</span><br />Software.</h1>
            <p className="hero-description">Connect with developers, collaborate on projects, manage tasks, and turn ideas into real-world software.</p>
            <div className="hero-actions">
              <Link className="button" to="/projects">Explore Projects <span aria-hidden="true">↗</span></Link>
              <Link className="text-button" to="/community">Join the Community <span aria-hidden="true">→</span></Link>
            </div>
          <div className="hero-footnote"><span className="footnote-marker" aria-hidden="true">↗</span><span>Good ideas get better with a team.</span></div>
          </div>
          <WorkspacePreview />
        </section>

        <section className="signal-bar page-width" aria-label="Platform principles"><span>Less busywork.</span><i /><span>More building.</span><i /><span>Better together.</span><span className="signal-note">MADE FOR THE WORK BEHIND THE WORK <b>↘</b></span></section>

        <section className="features-section page-width" id="projects">
          <div className="section-heading"><div><div className="eyebrow section-eyebrow">THE WHOLE LOOP <span>—</span> IN ONE PLACE</div><h2>Everything your<br />team needs to build.</h2></div><p>Keep the people, the plan, and the progress connected—so your team can spend less time coordinating and more time making.</p></div>
          <div className="feature-grid">
            {features.map((feature) => <article className="feature-card" id={feature.title === 'Developer Community' ? 'community' : feature.title === 'Code Sharing' ? 'code-sharing' : undefined} key={feature.number}><div className="feature-top"><span>{feature.number}</span><i aria-hidden="true">↗</i></div><h3>{feature.title}</h3><p>{feature.text}</p></article>)}
          </div>
        </section>

        <section className="steps-section page-width" aria-labelledby="steps-title">
          <div className="steps-heading"><div className="eyebrow">A SIMPLE WAY TO GET THERE</div><h2 id="steps-title">From first idea to first release.</h2></div>
          <div className="steps-grid">
            <article className="step-card"><span className="step-number">01</span><h3>Discover</h3><p>Find projects worth your time and people who share your curiosity.</p></article>
            <span className="step-arrow" aria-hidden="true">→</span>
            <article className="step-card"><span className="step-number">02</span><h3>Collaborate</h3><p>Bring the team together, agree on a plan, and keep work moving.</p></article>
            <span className="step-arrow" aria-hidden="true">→</span>
            <article className="step-card"><span className="step-number">03</span><h3>Build</h3><p>Share what you make, learn from the process, and ship something real.</p></article>
          </div>
        </section>

        <section className="build-band" id="get-started"><div className="page-width build-content"><div className="build-mark" aria-hidden="true">{'{ }'}</div><div><div className="eyebrow">MAKE THE NEXT STEP A SHARED ONE</div><h2>Your next great project<br />starts with collaboration.</h2></div><Link className="button button-light" to="/register">Get Started <span aria-hidden="true">↗</span></Link></div></section>
      </main>

      <footer className="site-footer page-width">
        <div className="footer-main"><a className="brand footer-brand" href="#top"><BrandMark /><span>DEV<span className="brand-light">COLLAB</span></span></a><p>A workspace for developers to meet, learn, and build useful things together.</p></div>
        <nav className="footer-nav" aria-label="Footer navigation"><Link to="/projects">Explore Projects</Link><Link to="/community">Community</Link><Link to="/snippets">Code Sharing</Link><a href="https://github.com/" target="_blank" rel="noreferrer">GitHub ↗</a><a href="#top">About</a></nav>
        <div className="footer-bottom"><span>Make useful things. Make them together.</span><span>© 2026 DEVCOLLAB</span></div>
      </footer>
    </div>
  );
}

export default LandingPage;
