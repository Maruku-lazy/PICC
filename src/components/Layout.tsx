import { useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  BookOpen, ChevronRight, ClipboardList, GraduationCap, LayoutDashboard,
  LogOut, Menu, ShieldAlert, X,
} from 'lucide-react';
import { useDemo } from '../context/DemoContext';

type NavEntry = { path: string; label: string; icon: typeof LayoutDashboard };

export default function Layout({ children }: { children: ReactNode }) {
  const { role, logout, isSupabase, displayName } = useDemo();
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoUnavailable, setLogoUnavailable] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const nav: NavEntry[] = role === 'student' ? [
    { path: '/student/dashboard', label: 'Overview', icon: LayoutDashboard },
    { path: '/student/application', label: 'My application', icon: ClipboardList },
  ] : [
    { path: '/registrar/dashboard', label: 'Application queue', icon: LayoutDashboard },
    { path: '/registrar/roadmap', label: 'Upcoming modules', icon: BookOpen },
  ];
  const title = role === 'student' ? 'Student Portal' : "Registrar's Office";
  const crumb = location.pathname.includes('application') ? 'Applications' : location.pathname.includes('roadmap') ? 'Upcoming modules' : 'Overview';
  async function handleLogout() {
    try {
      await logout();
      navigate('/login', { replace: true });
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not sign out.');
    }
  }
  return (
    <div className="app-shell">
      {menuOpen && <button className="mobile-overlay" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
      <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">
            {logoUnavailable ? (
              <GraduationCap size={25} strokeWidth={1.8} aria-hidden="true" />
            ) : (
              <img
                src="/images/picc-logo.jpg"
                alt="Pilar Community College logo"
                onError={() => setLogoUnavailable(true)}
              />
            )}
          </div>
          <div><strong>PiCC</strong><small>Enrollment Management</small></div>
          <button className="icon-button mobile-close" aria-label="Close menu" onClick={() => setMenuOpen(false)}><X size={20}/></button>
        </div>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          {nav.map((entry) => {
            const Icon = entry.icon;
            return <NavLink key={entry.path} to={entry.path} onClick={() => setMenuOpen(false)} className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}>
              <Icon size={19}/><span>{entry.label}</span><ChevronRight size={15} className="nav-chevron" />
            </NavLink>;
          })}
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-note"><ShieldAlert size={18}/><span>{isSupabase ? 'Development database. Use fictional student information only.' : 'Local prototype only. No real authentication or database.'}</span></div>
        <button className="logout" onClick={() => void handleLogout()}><LogOut size={18}/> Sign out</button>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button menu-button" aria-label="Open navigation" onClick={() => setMenuOpen(true)}><Menu size={23}/></button>
            <div className="breadcrumb"><span>PiCC</span><ChevronRight size={15}/><strong>{crumb}</strong></div>
          </div>
          <div className="topbar-right"><span className="prototype-pill">{isSupabase ? 'DEV DATABASE' : 'DEMO MODE'}</span><div className="user-avatar">{role === 'student' ? 'S' : 'R'}</div><span className="topbar-role">{isSupabase ? displayName : role === 'student' ? 'Demo Student' : 'Demo Registrar'}</span></div>
        </header>
        <div className="demo-banner"><ShieldAlert size={17}/><span><strong>{isSupabase ? 'Development environment.' : 'Frontend prototype.'}</strong> {isSupabase ? 'Applications are saved to Supabase. Do not enter real student information without institutional approval.' : 'Sample data is saved in this browser only. Do not enter real student information.'}</span><Link to={role === 'student' ? '/student/application' : '/registrar/roadmap'}>Learn more</Link></div>
        <main className="main-content"><div className="page-container"><div className="sr-only">{title}</div>{children}</div></main>
      </div>
    </div>
  );
}
