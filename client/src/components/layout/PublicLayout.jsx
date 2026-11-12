import { Link, Outlet } from 'react-router-dom';
import { Code2, Moon, Sun } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useTheme } from '../../context/ThemeContext.jsx';

export default function PublicLayout() {
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  return <div className="public-shell"><header className="public-header page-width"><Link to="/" className="brand"><span className="brand-mark"><span /><span /><span /></span><span>DEV<span className="brand-light">COLLAB</span></span></Link><nav><Link to="/projects">Explore Projects</Link><Link to="/community">Community</Link><Link to="/snippets">Code Sharing</Link></nav><div className="public-header-actions"><button className="icon-button" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button>{user ? <Link className="button button-small" to="/app/dashboard">Open workspace <Code2 size={14} /></Link> : <><Link className="login-link" to="/login">Log in</Link><Link className="button button-small" to="/register">Get started <span>↗</span></Link></>}</div></header><Outlet /><footer className="public-footer page-width"><span>© 2026 DEVCOLLAB</span><span>Build useful things together.</span><Link to="/">Home</Link></footer></div>;
}
