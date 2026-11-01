import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { BookOpen, CalendarDays, ClipboardList, Clock3, Layers3, Plus, RefreshCw, School, ShieldAlert } from 'lucide-react';
import { useDemo } from '../context/DemoContext';
import { Link } from 'react-router-dom';
import {
  createAcademicRecord, formatAcademicTerm, getAcademicCatalog,
  setCurrentAcademicTerm, updateAcademicRecord, WEEKDAYS, yearLooksValid,
  type AcademicCatalog, type Course, type Offering, type Program,
  type Section, type Term, type Meeting, type SemesterKey,
} from '../services/academicService';
import './AcademicManagement.css';

type Tab = 'terms' | 'programs' | 'courses' | 'sections' | 'offerings';
const NAV: Array<{ key: Tab; label: string; icon: typeof CalendarDays }> = [
  { key: 'terms', label: 'Academic terms', icon: CalendarDays },
  { key: 'programs', label: 'Programs', icon: School },
  { key: 'courses', label: 'Course catalog', icon: BookOpen },
  { key: 'sections', label: 'Class sections', icon: Layers3 },
  { key: 'offerings', label: 'Offerings & schedules', icon: Clock3 },
];
const EMPTY: AcademicCatalog = { terms: [], programs: [], courses: [], sections: [], offerings: [], meetings: [] };
const SEMESTERS: Array<{ value: SemesterKey; label: string }> = [
  { value: '1st', label: '1st semester' }, { value: '2nd', label: '2nd semester' }, { value: 'summer', label: 'Summer' },
];

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="ac-field"><span>{label}</span>{children}</label>;
}
function Empty({ text }: { text: string }) { return <p className="ac-empty">{text}</p>; }
function ActiveBadge({ active }: { active: boolean }) {
  return <span className={`ac-state ${active ? 'on' : 'off'}`}>{active ? 'Active' : 'Archived'}</span>;
}
function SaveButton({ working, label = 'Add record' }: { working: boolean; label?: string }) {
  return <button type="submit" className="button button-primary" disabled={working}>
    <Plus size={16}/>{working ? 'Saving…' : label}
  </button>;
}

export default function AcademicManagement() {
  const { isSupabase } = useDemo();
  const [tab, setTab] = useState<Tab>('terms');
  const [catalog, setCatalog] = useState<AcademicCatalog>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [termForm, setTermForm] = useState({ academic_year: '', semester: '1st' as SemesterKey, start_date: '', end_date: '' });
  const [programForm, setProgramForm] = useState({ code: '', name: '' });
  const [courseForm, setCourseForm] = useState({ program_id: '', course_code: '', title: '', units: '3', recommended_year: '1', recommended_semester: '1st' as SemesterKey });
  const [sectionForm, setSectionForm] = useState({ term_id: '', program_id: '', year_level: '1', section_name: '', capacity: '40' });
  const [offeringForm, setOfferingForm] = useState({ section_id: '', course_id: '', instructor_name: '' });
  const [meetingForm, setMeetingForm] = useState({ offering_id: '', weekday: '1', start_time: '08:00', end_time: '09:00', room: '' });
  const [editingInstructorId, setEditingInstructorId] = useState<string | null>(null);
  const [instructorDraft, setInstructorDraft] = useState('');

  const reload = useCallback(async (silent = false) => {
    if (!isSupabase) { setLoading(false); return; }
    if (!silent) setLoading(true);
    try { setCatalog(await getAcademicCatalog()); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load academic records.'); }
    finally { if (!silent) setLoading(false); }
  }, [isSupabase]);
  useEffect(() => { void reload(); }, [reload]);

  async function execute(action: () => Promise<void>, success: string) {
    setWorking(true); setNotice(''); setError('');
    try { await action(); setNotice(success); await reload(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save this change.'); }
    finally { setWorking(false); }
  }
  async function submit(e: FormEvent<HTMLFormElement>, action: () => Promise<void>, success: string) {
    e.preventDefault(); await execute(action, success);
  }
  const programName = (id: string) => catalog.programs.find(p => p.id === id)?.name ?? 'Unknown program';
  const termName = (id: string) => { const t = catalog.terms.find(t => t.id === id); return t ? formatAcademicTerm(t) : 'Unknown term'; };
  const courseName = (id: string) => { const c = catalog.courses.find(c => c.id === id); return c ? `${c.course_code} · ${c.title}` : 'Unknown course'; };
  const sectionName = (id: string) => { const s = catalog.sections.find(s => s.id === id); return s ? `${s.section_name} (Year ${s.year_level}) · ${programName(s.program_id)} · ${termName(s.term_id)}` : 'Unknown section'; };
  const pickedSection = catalog.sections.find(s => s.id === offeringForm.section_id);
  const sectionCourses = useMemo(() => catalog.courses.filter(c => c.active && c.program_id === pickedSection?.program_id), [catalog.courses, pickedSection?.program_id]);
  const currentTerm = catalog.terms.find(t => t.is_current);

  if (!isSupabase) return <div className="surface-card ac-notice"><ShieldAlert size={23}/> Academic Management requires your connected Supabase development project. Switch from Demo Mode.</div>;

  return <>
    <div className="page-header"><div><div className="eyebrow">REGISTRAR WORKSPACE · ACADEMIC MANAGEMENT</div><h1>Academic setup</h1>
      <p className="muted">Manage terms, programs, courses, sections, and class schedules before assigning students to subjects.</p></div>
      <span className="page-icon"><ClipboardList size={28}/></span></div>
    <div className="notice-warning">Academic setup is preparatory: the ‘Enrollment open’ toggle does not yet restrict student application submission, and courses are not yet assigned to students. Add only PiCC-approved subjects.</div>
    <div className="ac-stats">
      <div><strong>{catalog.terms.length}</strong><span>Academic terms</span></div>
      <div><strong>{catalog.programs.filter(p => p.active).length}</strong><span>Active programs</span></div>
      <div><strong>{catalog.courses.filter(c => c.active).length}</strong><span>Active courses</span></div>
      <div><strong>{catalog.sections.filter(s => s.active).length}</strong><span>Active sections</span></div>
    </div>
    <div className="ac-toolbar"><span>Current term: <strong>{currentTerm ? formatAcademicTerm(currentTerm) : 'Not selected'}</strong></span>
      <div className="ac-toolbar-actions"><Link to="/registrar/curricula" className="button button-secondary"><BookOpen size={15}/>Curriculum versions</Link>
      <button type="button" className="button button-secondary" disabled={loading || working} onClick={() => void reload()}><RefreshCw size={15}/>Refresh</button></div></div>
    {error && <div className="notice-error" role="alert">{error}</div>}
    {notice && <div className="notice-success" role="status">{notice}</div>}
    <div className="ac-tabs" role="tablist" aria-label="Academic management areas">{NAV.map(item => {
      const Icon = item.icon;
      return <button type="button" role="tab" aria-selected={tab === item.key} key={item.key}
        className={tab === item.key ? 'selected' : ''} onClick={() => { setTab(item.key); setNotice(''); setError(''); }}>
        <Icon size={16}/>{item.label}
      </button>;
    })}</div>
    {loading ? <div className="surface-card ac-notice" role="status">Loading academic records…</div> : <>
      {tab === 'terms' && <div className="ac-layout">
        <section className="surface-card ac-panel"><h2>Add academic term</h2><p className="muted">Set the active semester before scheduling classes.</p>
          <form className="ac-form" onSubmit={e => void submit(e, async () => {
            if (!yearLooksValid(termForm.academic_year)) throw new Error('Use consecutive years, such as 2026-2027.');
            await createAcademicRecord('terms', { ...termForm, start_date: termForm.start_date || null, end_date: termForm.end_date || null });
            setTermForm(f => ({ ...f, start_date: '', end_date: '' }));
          }, 'Academic term added.')}>
            <Field label="Academic year"><input required placeholder="2026-2027" value={termForm.academic_year} onChange={e => setTermForm(f => ({ ...f, academic_year: e.target.value }))}/></Field>
            <Field label="Semester"><select value={termForm.semester} onChange={e => setTermForm(f => ({ ...f, semester: e.target.value as SemesterKey }))}>{SEMESTERS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select></Field>
            <Field label="Start date (optional)"><input type="date" value={termForm.start_date} onChange={e => setTermForm(f => ({ ...f, start_date: e.target.value }))}/></Field>
            <Field label="End date (optional)"><input type="date" value={termForm.end_date} onChange={e => setTermForm(f => ({ ...f, end_date: e.target.value }))}/></Field>
            <SaveButton working={working}/></form></section>
        <section className="surface-card ac-panel ac-records"><h2>Academic terms</h2>
          {catalog.terms.length === 0 ? <Empty text="No terms yet. Add one to begin."/> : catalog.terms.map((t: Term) => <div className="ac-record" key={t.id}>
            <div><strong>{formatAcademicTerm(t)}</strong><small>{t.start_date || 'Date TBD'} – {t.end_date || 'Date TBD'}</small>
              <div className="ac-badges">{t.is_current && <span className="ac-state on">Current</span>}<span className={`ac-state ${t.enrollment_open ? 'on' : 'off'}`}>{t.enrollment_open ? 'Enrollment open' : 'Enrollment closed'}</span></div></div>
            <div className="ac-actions"><button type="button" disabled={working || t.is_current} onClick={() => void execute(() => setCurrentAcademicTerm(t.id), 'Current term updated.')}>Set current</button>
              <button type="button" disabled={working} onClick={() => void execute(() => updateAcademicRecord('terms', t.id, { enrollment_open: !t.enrollment_open }), 'Enrollment period updated.')}>{t.enrollment_open ? 'Close enrollment' : 'Open enrollment'}</button></div>
          </div>)}
        </section></div>}
      {tab === 'programs' && <div className="ac-layout"><section className="surface-card ac-panel"><h2>Add program</h2><p className="muted">PiCC's four existing form programs are preloaded, without course details.</p>
        <form className="ac-form" onSubmit={e => void submit(e, async () => {
          await createAcademicRecord('programs', { code: programForm.code.trim(), name: programForm.name.trim() });
          setProgramForm({ code: '', name: '' });
        }, 'Program added.')}>
          <Field label="Program code"><input maxLength={24} required placeholder="BSXYZ" value={programForm.code} onChange={e => setProgramForm(f => ({ ...f, code: e.target.value }))}/></Field>
          <Field label="Official program name"><input maxLength={180} required value={programForm.name} onChange={e => setProgramForm(f => ({ ...f, name: e.target.value }))}/></Field><SaveButton working={working}/>
        </form></section>
        <section className="surface-card ac-panel ac-records"><h2>Programs</h2>{catalog.programs.map((p: Program) => <div className="ac-record" key={p.id}><div><strong>{p.name}</strong><small>{p.code}</small><ActiveBadge active={p.active}/></div><div className="ac-actions"><button type="button" disabled={working} onClick={() => void execute(() => updateAcademicRecord('programs', p.id, { active: !p.active }), 'Program status updated.')}>{p.active ? 'Archive' : 'Reactivate'}</button></div></div>)}</section></div>}
      {tab === 'courses' && <div className="ac-layout"><section className="surface-card ac-panel"><h2>Add course</h2><p className="muted">Enter courses only from a PiCC-approved curriculum. Year and semester are recommendations, not an automatic enrollment assignment.</p>
        <form className="ac-form" onSubmit={e => void submit(e, async () => {
          await createAcademicRecord('courses', { ...courseForm, units: Number(courseForm.units), recommended_year: Number(courseForm.recommended_year) });
          setCourseForm(f => ({ ...f, course_code: '', title: '' }));
        }, 'Course added.')}>
          <Field label="Program"><select required value={courseForm.program_id} onChange={e => setCourseForm(f => ({ ...f, program_id: e.target.value }))}><option value="">Choose a program</option>{catalog.programs.filter(p => p.active).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="Course code"><input maxLength={24} required placeholder="e.g., CS 101" value={courseForm.course_code} onChange={e => setCourseForm(f => ({ ...f, course_code: e.target.value }))}/></Field>
          <Field label="Official course title"><input maxLength={200} required value={courseForm.title} onChange={e => setCourseForm(f => ({ ...f, title: e.target.value }))}/></Field>
          <Field label="Units"><input type="number" required min="0.5" max="30" step="0.5" value={courseForm.units} onChange={e => setCourseForm(f => ({ ...f, units: e.target.value }))}/></Field>
          <Field label="Recommended year"><select value={courseForm.recommended_year} onChange={e => setCourseForm(f => ({ ...f, recommended_year: e.target.value }))}>{[1,2,3,4,5].map(n => <option key={n} value={n}>Year {n}</option>)}</select></Field>
          <Field label="Recommended semester"><select value={courseForm.recommended_semester} onChange={e => setCourseForm(f => ({ ...f, recommended_semester: e.target.value as SemesterKey }))}>{SEMESTERS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select></Field><SaveButton working={working}/></form></section>
        <section className="surface-card ac-panel ac-records"><h2>Course catalog</h2>{catalog.courses.length === 0 ? <Empty text="No courses. Add approved subjects to the catalog."/> : catalog.courses.map((c: Course) => <div className="ac-record" key={c.id}>
          <div><strong>{c.course_code} · {c.title}</strong><small>{programName(c.program_id)} · {c.units} units · Year {c.recommended_year} / {c.recommended_semester}</small><ActiveBadge active={c.active}/></div>
          <div className="ac-actions"><button type="button" disabled={working} onClick={() => void execute(() => updateAcademicRecord('courses', c.id, { active: !c.active }), 'Course status updated.')}>{c.active ? 'Archive' : 'Reactivate'}</button></div></div>)}</section></div>}
      {tab === 'sections' && <div className="ac-layout"><section className="surface-card ac-panel"><h2>Add class section</h2><p className="muted">A section belongs to a specific academic term, program, and year level.</p>
        <form className="ac-form" onSubmit={e => void submit(e, async () => {
          await createAcademicRecord('sections', { ...sectionForm, year_level: Number(sectionForm.year_level), capacity: Number(sectionForm.capacity) });
          setSectionForm(f => ({ ...f, section_name: '' }));
        }, 'Section added.')}>
          <Field label="Academic term"><select required value={sectionForm.term_id} onChange={e => setSectionForm(f => ({ ...f, term_id: e.target.value }))}><option value="">Choose a term</option>{catalog.terms.map(t => <option key={t.id} value={t.id}>{formatAcademicTerm(t)}</option>)}</select></Field>
          <Field label="Program"><select required value={sectionForm.program_id} onChange={e => setSectionForm(f => ({ ...f, program_id: e.target.value }))}><option value="">Choose a program</option>{catalog.programs.filter(p => p.active).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="Year level"><select value={sectionForm.year_level} onChange={e => setSectionForm(f => ({ ...f, year_level: e.target.value }))}>{[1,2,3,4,5].map(n => <option key={n} value={n}>Year {n}</option>)}</select></Field>
          <Field label="Section name"><input maxLength={40} required placeholder="e.g., 1A" value={sectionForm.section_name} onChange={e => setSectionForm(f => ({ ...f, section_name: e.target.value }))}/></Field>
          <Field label="Maximum capacity"><input type="number" required min="1" max="500" value={sectionForm.capacity} onChange={e => setSectionForm(f => ({ ...f, capacity: e.target.value }))}/></Field>
          <SaveButton working={working}/></form></section>
        <section className="surface-card ac-panel ac-records"><h2>Class sections</h2>{catalog.sections.length === 0 ? <Empty text="No sections have been configured."/> : catalog.sections.map((s: Section) => <div className="ac-record" key={s.id}><div><strong>{s.section_name} · Year {s.year_level}</strong><small>{programName(s.program_id)} · {termName(s.term_id)} · {s.capacity} seats</small><ActiveBadge active={s.active}/></div><div className="ac-actions"><button type="button" disabled={working} onClick={() => void execute(() => updateAcademicRecord('sections', s.id, { active: !s.active }), 'Section status updated.')}>{s.active ? 'Archive' : 'Reactivate'}</button></div></div>)}</section></div>}
      {tab === 'offerings' && <div className="ac-stack">
        <div className="ac-layout"><section className="surface-card ac-panel"><h2>Create subject offering</h2><p className="muted">Registrar assigns the subject to a section. Instructor is entered by name until PiCC authorizes a staff directory.</p>
          <form className="ac-form" onSubmit={e => void submit(e, async () => {
            if (!pickedSection) throw new Error('Choose a class section.');
            if (!catalog.courses.some(c => c.id === offeringForm.course_id && c.program_id === pickedSection.program_id && c.active)) throw new Error('Choose a course from the same program as this section.');
            await createAcademicRecord('offerings', { ...offeringForm, program_id: pickedSection.program_id });
            setOfferingForm(f => ({ ...f, course_id: '' }));
          }, 'Subject offering added.')}>
            <Field label="Class section"><select required value={offeringForm.section_id} onChange={e => setOfferingForm(f => ({ ...f, section_id: e.target.value, course_id: '' }))}><option value="">Choose section</option>{catalog.sections.filter(s => s.active).map(s => <option key={s.id} value={s.id}>{sectionName(s.id)}</option>)}</select></Field>
            <Field label="Course"><select required value={offeringForm.course_id} onChange={e => setOfferingForm(f => ({ ...f, course_id: e.target.value }))}><option value="">Choose matching course</option>{sectionCourses.map(c => <option key={c.id} value={c.id}>{c.course_code} · {c.title}</option>)}</select></Field>
            <Field label="Instructor name (optional)"><input maxLength={160} value={offeringForm.instructor_name} onChange={e => setOfferingForm(f => ({ ...f, instructor_name: e.target.value }))} placeholder="To be assigned"/></Field>
            <SaveButton working={working} label="Create offering"/>
          </form></section>
          <section className="surface-card ac-panel"><h2>Add meeting time</h2><p className="muted">Add multiple rows for multiple weekly class days. The database checks overlapping sections, rooms, and instructor names.</p>
            <form className="ac-form" onSubmit={e => void submit(e, async () => {
              if (meetingForm.start_time >= meetingForm.end_time) throw new Error('End time must be later than start time.');
              await createAcademicRecord('meetings', { ...meetingForm, weekday: Number(meetingForm.weekday) });
              setMeetingForm(f => ({ ...f, room: '' }));
            }, 'Meeting schedule saved.')}>
              <Field label="Subject offering"><select required value={meetingForm.offering_id} onChange={e => setMeetingForm(f => ({ ...f, offering_id: e.target.value }))}><option value="">Choose offering</option>{catalog.offerings.filter(o => o.active).map(o => <option key={o.id} value={o.id}>{courseName(o.course_id)} — {sectionName(o.section_id)}</option>)}</select></Field>
              <Field label="Day"><select value={meetingForm.weekday} onChange={e => setMeetingForm(f => ({ ...f, weekday: e.target.value }))}>{WEEKDAYS.map((day,i) => <option key={day} value={i+1}>{day}</option>)}</select></Field>
              <Field label="Start"><input type="time" required value={meetingForm.start_time} onChange={e => setMeetingForm(f => ({ ...f, start_time: e.target.value }))}/></Field>
              <Field label="End"><input type="time" required value={meetingForm.end_time} onChange={e => setMeetingForm(f => ({ ...f, end_time: e.target.value }))}/></Field>
              <Field label="Room (optional)"><input maxLength={90} value={meetingForm.room} onChange={e => setMeetingForm(f => ({ ...f, room: e.target.value }))} placeholder="e.g., Room 201"/></Field>
              <SaveButton working={working} label="Add meeting"/>
            </form></section></div>
        <section className="surface-card ac-panel ac-records"><h2>Course offerings and schedules</h2>
          {catalog.offerings.length === 0 ? <Empty text="No offerings yet. Add one after creating sections and courses."/> : catalog.offerings.map((o: Offering) => <div className="ac-record ac-offering" key={o.id}>
            <div><strong>{courseName(o.course_id)}</strong><small>{sectionName(o.section_id)} · Instructor: {o.instructor_name || 'Not assigned'}</small>
              {editingInstructorId === o.id ? <form className="ac-inline-edit" onSubmit={e => void submit(e, async () => {
                await updateAcademicRecord('offerings', o.id, { instructor_name: instructorDraft.trim() });
                setEditingInstructorId(null);
              }, 'Instructor assignment updated.')}><input aria-label="Instructor name" maxLength={160} value={instructorDraft} onChange={e => setInstructorDraft(e.target.value)} placeholder="Instructor name"/><button type="submit" disabled={working}>Save</button><button type="button" onClick={() => setEditingInstructorId(null)}>Cancel</button></form> : <button type="button" className="ac-small-link" disabled={working} onClick={() => { setEditingInstructorId(o.id); setInstructorDraft(o.instructor_name); }}>Edit instructor</button>}
              <div className="ac-badges"><ActiveBadge active={o.active}/></div>
              <div className="ac-meetings">{catalog.meetings.filter(m => m.offering_id === o.id).length === 0 ? <span>No meeting times added</span> : catalog.meetings.filter(m => m.offering_id === o.id).map((m: Meeting) => <span key={m.id} className={m.active ? '' : 'ac-inactive-meeting'}>{WEEKDAYS[m.weekday-1]}, {m.start_time.slice(0,5)}–{m.end_time.slice(0,5)} · {m.room || 'Room TBA'} <button type="button" disabled={working} onClick={() => void execute(() => updateAcademicRecord('meetings', m.id, { active: !m.active }), 'Meeting schedule updated.')}>{m.active ? 'Disable' : 'Restore'}</button></span>)}</div>
            </div><div className="ac-actions"><button type="button" disabled={working} onClick={() => void execute(() => updateAcademicRecord('offerings', o.id, { active: !o.active }), 'Offering status updated.')}>{o.active ? 'Archive' : 'Reactivate'}</button></div></div>)}
        </section>
      </div>}
    </>}
  </>;
}
