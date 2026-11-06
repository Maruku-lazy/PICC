import { BookOpenCheck, BrainCircuit, CalendarDays, Database, FileCheck2, LockKeyhole, ReceiptText } from 'lucide-react';
const modules: Array<{ icon: typeof LockKeyhole; name: string; info: string; status: string }> = [
  { icon: LockKeyhole, name: 'Real accounts & permissions', info: 'Supabase Auth, secure profiles, and role-based permissions.', status: 'Implemented' },
  { icon: Database, name: 'Database-backed enrollment', info: 'PostgreSQL student records, statuses, and audit history.', status: 'Implemented' },
  { icon: FileCheck2, name: 'Requirement uploads', info: 'Private document uploads, checklists, and Registrar review.', status: 'Implemented' },
  { icon: BrainCircuit, name: 'AI-assisted OCR screening', info: 'Automatic first-pass OCR, comparison findings, and human document verdicts. Formal accuracy evaluation is deferred.', status: 'Prototype working' },
  { icon: CalendarDays, name: 'Academic management', info: 'Academic terms, program/course catalog, sections, class schedules, and initial instructor names. Curricula, prerequisites, and Registrar subject/section assignment are implemented. Final enrollment remains separate.', status: 'Core implemented' },
  { icon: ReceiptText, name: 'Assessment and confirmation', info: 'Registrar payment-status verification without online payment processing, final approval, and a development COR draft. Local verification and official template approval are still needed.', status: 'Implemented · testing needed' },
  { icon: BookOpenCheck, name: 'Electronic grading', info: 'Outside the initial BSCS enrollment scope; revisit only if PiCC and the adviser approve.', status: 'Deferred / out of scope' },
];
export default function RoadmapPage() { return <><div className="page-header"><div><div className="eyebrow">DEVELOPMENT ROADMAP</div><h1>Development roadmap</h1><p className="muted">Current module progress and remaining enrollment work. Formal OCR evaluation is deferred while core workflows are developed.</p></div></div><div className="roadmap-grid">{modules.map((m) => { const Icon = m.icon; return <div className="surface-card roadmap-card" key={m.name}><div className="roadmap-head"><span className="metric-icon mint"><Icon size={20}/></span><span className="tag-neutral">{m.status}</span></div><h2>{m.name}</h2><p>{m.info}</p></div>; })}</div></>;
}
