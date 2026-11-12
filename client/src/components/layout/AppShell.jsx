import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Bell, CheckSquare, ChevronDown, Code2, Compass, FolderKanban, Home, LogOut, Menu, MessageCircle, Moon, Search, Settings, Shield, Sun, Users, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useTheme } from '../../context/ThemeContext.jsx';
import api from '../../services/api.js';
import { createSocket } from '../../services/socket.js';

const navigation = [
  { to: '/app/dashboard', label: 'Dashboard', icon: Home, end: true },
  { to: '/app/projects', label: 'Explore Projects', icon: Compass, end: true },
  { to: '/app/projects/mine', label: 'My Projects', icon: FolderKanban },
  { to: '/app/teams', label: 'Team Collaboration', icon: Users },
  { to: '/app/tasks', label: 'Tasks', icon: CheckSquare },
  { to: '/app/messages', label: 'Messages', icon: MessageCircle },
  { to: '/app/snippets', label: 'Code Sharing', icon: Code2 },
  { to: '/app/community', label: 'Community', icon: Users },
  { to: '/app/notifications', label: 'Notifications', icon: Bell },
  { to: '/app/settings', label: 'Settings', icon: Settings },
];

function initials(user) {
  return user?.fullName?.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'D';
}

export default function AppShell() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [unread, setUnread] = useState(0);
  const [apiHealth, setApiHealth] = useState('checking');
  const title = /^\/app\/projects\/[a-f\d]{24}$/i.test(location.pathname) ? 'Project workspace' : location.pathname === '/app/projects/mine' ? 'My projects' : navigation.find((item) => item.to === location.pathname)?.label || (location.pathname.endsWith('/admin') ? 'Admin Panel' : 'Workspace');

  useEffect(() => {
    const refreshUnread = () => api.get('/notifications', { params: { limit: 1 } }).then(({ data }) => setUnread(data.unreadCount || 0)).catch(() => {});
    refreshUnread();
    window.addEventListener('devcollab:notifications-changed', refreshUnread);
    return () => window.removeEventListener('devcollab:notifications-changed', refreshUnread);
  }, [location.pathname]);

  useEffect(() => {
    api.get('/health').then(({ data }) => setApiHealth(data.data?.database === 'connected' ? 'connected' : 'database-offline')).catch(() => setApiHealth('offline'));
  }, []);

  useEffect(() => {
    const socket = createSocket();
    socket.on('notification:new', () => {
      setUnread((count) => count + 1);
      window.dispatchEvent(new Event('devcollab:notification-new'));
    });
    socket.connect();
    return () => socket.disconnect();
  }, [user?.id]);

  useEffect(() => {
    setMenuOpen(false);
    setProfileOpen(false);
  }, [location.pathname]);

  function submitSearch(event) {
    event.preventDefault();
    navigate(`/app/projects?q=${encodeURIComponent(search.trim())}`);
    setSearch('');
  }

  async function signOut() {
    await logout();
    navigate('/', { replace: true });
  }

  return (
    <div className="workspace-layout">
      {menuOpen && <button className="drawer-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
      <aside className={`workspace-sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-brand-row"><NavLink className="brand" to="/"><span className="brand-mark" aria-hidden="true"><span /><span /><span /></span><span>DEV<span className="brand-light">COLLAB</span></span></NavLink><button className="icon-button sidebar-close" onClick={() => setMenuOpen(false)} aria-label="Close navigation"><X size={17} /></button></div>
        <div className="workspace-switcher"><span className="workspace-switcher-icon"><Code2 size={14} /></span><span><strong>Personal workspace</strong><small>{user?.username ? `@${user.username}` : 'Developer space'}</small></span><ChevronDown size={14} /></div>
        <nav className="sidebar-nav" aria-label="Workspace navigation">
          <span className="sidebar-label">WORKSPACE</span>
          {navigation.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => `sidebar-link${isActive ? ' sidebar-link-active' : ''}`}><Icon size={16} strokeWidth={1.8} /><span>{label}</span>{label === 'Notifications' && unread > 0 && <b className="nav-count">{unread > 99 ? '99+' : unread}</b>}</NavLink>)}
          {user?.role === 'admin' && <><span className="sidebar-label sidebar-label-gap">MANAGE</span><NavLink to="/app/admin" className={({ isActive }) => `sidebar-link${isActive ? ' sidebar-link-active' : ''}`}><Shield size={16} /><span>Admin Panel</span></NavLink></>}
        </nav>
        <div className="sidebar-bottom"><div className={`connection-status${apiHealth === 'database-offline' || apiHealth === 'offline' ? ' status-offline' : ''}`}><span />{apiHealth === 'connected' ? 'All systems operational' : apiHealth === 'checking' ? 'Checking API status' : apiHealth === 'database-offline' ? 'Database configuration needed' : 'API unavailable'}</div><button className="account-card" onClick={() => setProfileOpen((open) => !open)}><span className="avatar avatar-small">{user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials(user)}</span><span className="account-copy"><strong>{user?.fullName || 'Developer'}</strong><small>{user?.email || `@${user?.username || 'member'}`}</small></span><ChevronDown size={14} /></button>{profileOpen && <div className="account-menu"><NavLink to="/app/settings"><Settings size={14} /> Profile & settings</NavLink><button onClick={signOut}><LogOut size={14} /> Sign out</button></div>}</div>
      </aside>

      <div className="workspace-main">
        <header className="workspace-topbar">
          <button className="icon-button mobile-menu-button" onClick={() => setMenuOpen(true)} aria-label="Open navigation"><Menu size={19} /></button>
          <div className="topbar-title"><span className="breadcrumb-root">DEVCOLLAB</span><span className="breadcrumb-divider">/</span><strong>{title}</strong></div>
          <form className="global-search" onSubmit={submitSearch}><Search size={14} /><input aria-label="Search projects" placeholder="Search projects…" value={search} onChange={(event) => setSearch(event.target.value)} /><kbd>↵</kbd></form>
          <div className="topbar-actions"><NavLink className="icon-button notification-button" to="/app/notifications" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}><Bell size={17} />{unread > 0 && <span className="notification-dot" />}</NavLink><button className="icon-button" type="button" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button><NavLink to="/app/settings" className="avatar avatar-top" aria-label="Open profile">{user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials(user)}</NavLink></div>
        </header>
        <main className="workspace-content"><Outlet /></main>
      </div>
    </div>
  );
}
