import { BookOpenCheck, BrainCircuit, CalendarDays, Database, FileCheck2, LockKeyhole, ReceiptText } from 'lucide-react';
const modules = [
  { icon: LockKeyhole, name: 'Real accounts & permissions', info: 'Supabase Auth, secure profiles, role-based permissions, and registrar approval.' },
  { icon: Database, name: 'Database-backed enrollment', info: 'PostgreSQL tables, per-student records, statuses, and audit history.' },
  { icon: FileCheck2, name: 'Requirement uploads', info: 'Private file storage, document-type checklists, and registrar review.' },
  { icon: BrainCircuit, name: 'AI-assisted OCR screening', info: 'Text extraction, comparisons with application fields, mismatch flags, and human decisions.' },
  { icon: CalendarDays, name: 'Academic management', info: 'Terms, curricula, courses, schedules, sections, and instructor assignments.' },
  { icon: ReceiptText, name: 'Assessment and confirmation', info: 'Payment-status verification, authorized enrollment approval, and COR output.' },
  { icon: BookOpenCheck, name: 'Electronic grading', info: 'Instructor grade entry and restricted academic workflows, subject to school approval.' },
];
export default function RoadmapPage() { return <><div className="page-header"><div><div className="eyebrow">DEVELOPMENT ROADMAP</div><h1>What's coming next</h1><p className="muted">This prototype intentionally starts small. Later development phases add real workflows one module at a time.</p></div></div><div className="roadmap-grid">{modules.map((m, i) => { const Icon = m.icon; return <div className="surface-card roadmap-card" key={m.name}><div className="roadmap-head"><span className="metric-icon mint"><Icon size={20}/></span><span className="tag-neutral">Phase {i+2}</span></div><h2>{m.name}</h2><p>{m.info}</p></div>; })}</div></>;
}
