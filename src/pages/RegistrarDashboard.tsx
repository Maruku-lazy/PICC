import { useMemo, useState } from 'react';
import { ArrowRight, ClipboardCheck, Clock3, FileCheck2, Inbox, Search, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useDemo } from '../context/DemoContext';
import { statusLabel } from '../types';

export default function RegistrarDashboard() {
  const { applications, resetDemo, isSupabase, dataLoading } = useDemo();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const sorted = useMemo(() => applications
    .filter((app) => app.status !== 'draft')
    .filter((app) => filter === 'all' || app.status === filter)
    .filter((app) => [app.fullName, app.program, app.email].some((v) => v.toLowerCase().includes(query.toLowerCase())))
    .sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)), [applications, filter, query]);
  const visible = applications.filter((app) => app.status !== 'draft');
  const waiting = visible.filter((app) => app.status === 'submitted' || app.status === 'under_review').length;
  const corrections = visible.filter((app) => app.status === 'needs_correction').length;
  const verified = visible.filter((app) => app.status === 'documents_verified').length;
  if (dataLoading) return <div className="soft-panel" role="status">Loading application queue…</div>;
  return <>
    <div className="page-header"><div><div className="eyebrow">REGISTRAR WORKSPACE</div><h1>Application management</h1><p className="muted">Review submitted applications and monitor their statuses.</p></div><span className="page-icon"><ClipboardCheck size={28}/></span></div>
    <div className="metrics registrar-metrics"><div className="metric"><span className="metric-icon mint"><Users size={20}/></span><span className="metric-label">Total submitted</span><strong>{visible.length.toString().padStart(2,'0')}</strong><small>Excludes student drafts</small></div><div className="metric"><span className="metric-icon lavender"><Clock3 size={20}/></span><span className="metric-label">For review</span><strong>{waiting.toString().padStart(2,'0')}</strong><small>Submitted or under review</small></div><div className="metric"><span className="metric-icon peach"><Inbox size={20}/></span><span className="metric-label">Needs correction</span><strong>{corrections.toString().padStart(2,'0')}</strong><small>Returned to student</small></div><div className="metric"><span className="metric-icon mint"><FileCheck2 size={20}/></span><span className="metric-label">Documents verified</span><strong>{verified.toString().padStart(2,'0')}</strong><small>Not final enrollment</small></div></div>
    <section className="surface-card queue-card"><div className="queue-header"><div><div className="eyebrow">APPLICANT RECORDS</div><h2>Application queue</h2><p className="muted">Select an application to review or request corrections.</p></div></div><div className="queue-tools"><div className="searchbox"><Search size={18}/><input aria-label="Search applications" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, email, or program"/></div><select aria-label="Filter application status" className="status-filter" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">All statuses</option><option value="submitted">Submitted</option><option value="under_review">Under review</option><option value="needs_correction">Needs correction</option><option value="documents_verified">Documents verified</option></select></div>
      {sorted.length ? <div className="table-wrap"><table><thead><tr><th>Student</th><th>Program</th><th>Date updated</th><th>Status</th><th className="table-last">Action</th></tr></thead><tbody>{sorted.map((app) => <tr key={app.id}><td><strong>{app.fullName || 'Unnamed applicant'}</strong><small>{app.email || '—'}</small></td><td>{app.program || '—'}</td><td>{new Date(app.updatedAt).toLocaleDateString()}</td><td><span className={`status-pill status-${app.status}`}>{statusLabel[app.status]}</span></td><td className="table-last"><Link to={`/registrar/applications/${app.id}`} className="text-link">Review <ArrowRight size={15}/></Link></td></tr>)}</tbody></table></div> : <div className="table-empty"><div className="empty-icon"><Inbox size={29}/></div><h3>No matching applications</h3><p>{visible.length ? 'Try a different search or status filter.' : 'No submitted applications are available yet.'}</p></div>}
    </section>
    {!isSupabase && applications.length > 0 && <div className="data-reset"><span>Need to start the demo over? This clears sample applications saved in this browser.</span><button className="text-link danger-link" onClick={() => { if (window.confirm('Delete all sample applications stored in this browser?')) resetDemo(); }}>Reset sample data</button></div>}
  </>;
}
