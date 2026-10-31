import { ArrowRight, CalendarDays, CheckCircle2, ClipboardList, Clock3, GraduationCap, Info } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useDemo } from '../context/DemoContext';
import { statusDescription, statusLabel } from '../types';

export default function StudentDashboard() {
  const { applications, userId, dataLoading, isSupabase } = useDemo();
  const app = applications.find((a) => a.studentId === userId);
  if (dataLoading) return <div className="soft-panel" role="status">Loading your application…</div>;
  return <>
    <div className="page-header"><div><div className="eyebrow">STUDENT WORKSPACE</div><h1>Welcome to your portal</h1><p className="muted">Manage your application and follow each step of the enrollment process.</p></div><span className="page-icon"><GraduationCap size={28}/></span></div>
    <div className="metrics student-metrics">
      <div className="metric"><span className="metric-icon mint"><ClipboardList size={20}/></span><span className="metric-label">Applications</span><strong>{app ? '01' : '00'}</strong><small>Current application record</small></div>
      <div className="metric"><span className="metric-icon lavender"><Clock3 size={20}/></span><span className="metric-label">Current status</span><strong className="metric-string">{app ? statusLabel[app.status] : 'Not started'}</strong><small>{app ? (isSupabase ? 'Saved in Supabase' : 'Last updated locally') : 'Begin your application'}</small></div>
      <div className="metric"><span className="metric-icon peach"><CalendarDays size={20}/></span><span className="metric-label">Academic term</span><strong className="metric-string">{app?.academicTerm || 'Not selected'}</strong><small>Based on your application</small></div>
    </div>
    <div className="two-columns">
      <section className="surface-card main-card"><div className="section-heading"><div><div className="eyebrow">YOUR ENROLLMENT</div><h2>Application overview</h2></div><span className="tag-neutral">Student</span></div>
        {app ? <div className="application-summary"><div className="summary-meta"><span className={`status-pill status-${app.status}`}>{statusLabel[app.status]}</span><span className="muted">Updated {new Date(app.updatedAt).toLocaleDateString()}</span></div><h3>{app.program || 'Program not selected'}</h3><p className="muted">{app.studentType.charAt(0).toUpperCase() + app.studentType.slice(1)} · {app.academicTerm || 'No term selected'}</p><div className="soft-panel"><Info size={18}/><span>{statusDescription[app.status]}</span></div>{app.reviewerNote && <div className="notice-warning"><strong>Registrar note</strong><p>{app.reviewerNote}</p></div>}<Link className="button button-primary" to="/student/application">{['draft','needs_correction'].includes(app.status) ? 'Continue application' : 'View application'} <ArrowRight size={17}/></Link></div> : <div className="empty-app"><div className="empty-icon"><ClipboardList size={31}/></div><h3>No application yet</h3><p>Start by filling in your basic details and selecting a program. You can save your progress and submit a sample application.</p><Link to="/student/application" className="button button-primary">Start an application <ArrowRight size={17}/></Link></div>}
      </section>
      <section className="surface-card steps-card"><div className="section-heading"><div><div className="eyebrow">HOW IT WORKS</div><h2>Enrollment stages</h2></div></div><div className="step-list"><div className="step-item"><span className="step-bubble done"><CheckCircle2 size={19}/></span><div><strong>Create your application</strong><p>Provide applicant information and select your academic program.</p></div></div><div className="step-item"><span className="step-bubble">2</span><div><strong>Submit requirements</strong><p>Document uploads and AI screening will be developed next.</p></div></div><div className="step-item"><span className="step-bubble">3</span><div><strong>Registrar verification</strong><p>The registrar reviews documents and requests corrections where needed.</p></div></div><div className="step-item"><span className="step-bubble">4</span><div><strong>Enrollment confirmation</strong><p>Assessment, payment verification, and final approval are future modules.</p></div></div></div></section>
    </div>
  </>;
}
