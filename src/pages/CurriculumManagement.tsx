import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, BookOpenCheck, CheckCircle2, CircleAlert, GitBranch, Plus, RefreshCw, ShieldAlert, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useDemo } from '../context/DemoContext';
import { getAcademicCatalog, type AcademicCatalog, type Course, type SemesterKey, yearLooksValid } from '../services/academicService';
import {
  addCurriculumItem, addPrerequisite, changeCurriculumStatus, createCurriculumVersion,
  loadCurriculumData, removeCurriculumItem, removePrerequisite, termSortIndex, wouldCreateCycle,
  type CurriculumData, type CurriculumItem, type CurriculumVersion,
} from '../services/curriculumService';
import './CurriculumManagement.css';

const EMPTY_ACADEMIC: AcademicCatalog = { terms: [], programs: [], courses: [], sections: [], offerings: [], meetings: [] };
const EMPTY_CURRICULUM: CurriculumData = { versions: [], items: [], prerequisites: [] };
const TERM_LABEL: Record<SemesterKey, string> = { '1st': 'First semester', '2nd': 'Second semester', summer: 'Summer' };

function Field({ title, children }: { title: string; children: ReactNode }) {
  return <label className="cm-field"><span>{title}</span>{children}</label>;
}
function State({ status }: { status: CurriculumVersion['status'] }) {
  return <span className={`cm-pill ${status}`}>{status === 'draft' ? 'Draft' : status === 'published' ? 'Published' : 'Retired'}</span>;
}

export default function CurriculumManagement() {
  const { isSupabase } = useDemo();
  const [academic, setAcademic] = useState<AcademicCatalog>(EMPTY_ACADEMIC);
  const [data, setData] = useState<CurriculumData>(EMPTY_CURRICULUM);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [programId, setProgramId] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [versionName, setVersionName] = useState('');
  const [year, setYear] = useState('');
  const [subjectCourseId, setSubjectCourseId] = useState('');
  const [subjectYear, setSubjectYear] = useState('1');
  const [subjectSemester, setSubjectSemester] = useState<SemesterKey>('1st');
  const [required, setRequired] = useState(true);
  const [targetItemId, setTargetItemId] = useState('');
  const [prereqItemId, setPrereqItemId] = useState('');

  const reload = useCallback(async (withLoading = true) => {
    if (!isSupabase) { setLoading(false); return; }
    if (withLoading) setLoading(true);
    try {
      const [a, c] = await Promise.all([getAcademicCatalog(), loadCurriculumData()]);
      setAcademic(a);
      setData(c);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load curriculum information.');
    } finally {
      if (withLoading) setLoading(false);
    }
  }, [isSupabase]);
  useEffect(() => { void reload(); }, [reload]);

  const versions = useMemo(() => data.versions.filter(v => !!programId && v.program_id === programId), [data.versions, programId]);
  const selected = versions.find(v => v.id === selectedId) ?? versions[0];
  const selectedVersionId = selected?.id ?? '';
  const items = useMemo(() => data.items.filter(i => i.curriculum_id === selectedVersionId).sort((a, b) =>
    termSortIndex(a.year_level, a.semester) - termSortIndex(b.year_level, b.semester)), [data.items, selectedVersionId]);
  const links = useMemo(() => data.prerequisites.filter(p => p.curriculum_id === selectedVersionId), [data.prerequisites, selectedVersionId]);
  const coursesById = useMemo(() => new Map(academic.courses.map(c => [c.id, c])), [academic.courses]);
  const itemsById = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);
  const availableCourses = useMemo(() => academic.courses.filter(c => c.active && c.program_id === selected?.program_id &&
    !items.some(i => i.course_id === c.id)), [academic.courses, selected?.program_id, items]);
  const selectedProgram = academic.programs.find(p => p.id === selected?.program_id);
  const isDraft = selected?.status === 'draft';
  const target = items.find(i => i.id === targetItemId) ?? items[0];
  const prereqChoices = items.filter(i => i.id !== target?.id && !links.some(link =>
    link.curriculum_item_id === target?.id && link.prerequisite_item_id === i.id) &&
    !wouldCreateCycle(links, target?.id ?? '', i.id));
  function courseLabel(course?: Course) { return course ? `${course.course_code} · ${course.title}` : 'Unknown subject'; }
  function itemLabel(item?: CurriculumItem) { return item ? courseLabel(coursesById.get(item.course_id)) : 'Unknown subject'; }

  async function run(change: () => Promise<void>, confirmation: string) {
    setError(''); setMessage(''); setWorking(true);
    try { await change(); await reload(false); setMessage(confirmation); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'The operation failed.'); }
    finally { setWorking(false); }
  }
  async function onCreateVersion(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!programId) return setError('Choose a program before creating a curriculum.');
    if (!yearLooksValid(year.trim())) return setError('Use a valid academic year such as 2026-2027.');
    await run(async () => {
      const id = await createCurriculumVersion({ program_id: programId, version_name: versionName.trim(), effective_academic_year: year.trim() });
      setSelectedId(id); setVersionName('');
    }, 'New draft created. Add approved subjects and prerequisites before publishing.');
  }
  async function onAddSubject(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!selected) return;
    await run(async () => {
      await addCurriculumItem({ curriculum_id: selected.id, program_id: selected.program_id,
        course_id: subjectCourseId, year_level: Number(subjectYear), semester: subjectSemester, is_required: required });
      setSubjectCourseId('');
    }, 'Subject added to the draft curriculum.');
  }
  async function onAddPrerequisite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!selected || !target || !prereqItemId) return;
    if (wouldCreateCycle(links, target.id, prereqItemId)) return setError('This prerequisite would create a circular dependency.');
    await run(async () => {
      await addPrerequisite({ curriculum_id: selected.id, curriculum_item_id: target.id, prerequisite_item_id: prereqItemId });
      setPrereqItemId('');
    }, 'Prerequisite added to the draft curriculum.');
  }
  async function onStatus(status: 'published' | 'retired') {
    if (!selected) return;
    const explanation = status === 'published'
      ? 'Publish this curriculum? You will NOT be able to edit its subjects or prerequisites afterward. Only publish an institution-approved curriculum.'
      : 'Retire this curriculum? It will remain in history and cannot be edited or republished.';
    if (!window.confirm(explanation)) return;
    await run(() => changeCurriculumStatus(selected.id, status), `Curriculum ${status}.`);
  }

  if (!isSupabase) return <section className="surface-card cm-alert"><ShieldAlert size={20}/> Curriculum Management requires an active Supabase connection.</section>;

  return <>
    <div className="page-header"><div><div className="eyebrow">REGISTRAR WORKSPACE · ACADEMIC MANAGEMENT</div><h1>Curriculum management</h1>
      <p className="muted">Build approved curriculum versions, assign subjects by year and semester, and define prerequisites.</p></div>
      <span className="page-icon"><BookOpenCheck size={27}/></span>
    </div>
    <div className="notice-warning">Use only PiCC-approved curriculum maps. A curriculum's publication does not assign subjects to students or automatically check prerequisite completion.</div>
    <div className="cm-toolbar"><Link to="/registrar/academics" className="cm-back">Academic management <ArrowRight size={14}/></Link>
      <button type="button" className="button button-secondary" onClick={() => void reload()} disabled={working || loading}><RefreshCw size={15}/>Refresh</button></div>
    {error && <div className="notice-error" role="alert">{error}</div>}
    {message && <div className="notice-success" role="status">{message}</div>}
    {loading ? <div className="surface-card cm-alert" role="status">Loading curricula…</div> : <>
      <div className="cm-setup">
        <section className="surface-card cm-panel"><h2>Program and curriculum version</h2>
          <Field title="Academic program"><select value={programId} onChange={e => { setProgramId(e.target.value); setSelectedId(''); setSubjectCourseId(''); setTargetItemId(''); setPrereqItemId(''); }}>
            <option value="">Choose a program</option>{academic.programs.filter(p => p.active).map(p => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
          </select></Field>
          <Field title="Select an existing curriculum"><select value={selectedVersionId} onChange={e => { setSelectedId(e.target.value); setSubjectCourseId(''); setTargetItemId(''); setPrereqItemId(''); }} disabled={!versions.length}>
            {!versions.length && <option value="">No versions yet</option>}
            {versions.map(v => <option key={v.id} value={v.id}>{v.version_name} · {v.effective_academic_year} ({v.status})</option>)}
          </select></Field>
          {selected && <div className="cm-selection"><div><strong>{selected.version_name}</strong><span>{selectedProgram?.name ?? 'Program'} · Effective {selected.effective_academic_year}</span></div><State status={selected.status}/></div>}
        </section>
        <section className="surface-card cm-panel"><h2>Create a new draft version</h2><p className="muted">Create a separate draft when revising a published curriculum.</p>
          <form className="cm-form" onSubmit={e => void onCreateVersion(e)}>
            <Field title="Version title"><input required maxLength={100} minLength={3} placeholder="e.g., 2026 curriculum revision A" value={versionName} onChange={e => setVersionName(e.target.value)}/></Field>
            <Field title="Effective academic year"><input required placeholder="2026-2027" value={year} onChange={e => setYear(e.target.value)}/></Field>
            <button type="submit" className="button button-primary" disabled={!programId || working}><Plus size={15}/>Create draft</button>
          </form></section>
      </div>
      {selected ? <div className="cm-content">
        <section className="surface-card cm-panel">
          <div className="cm-heading"><div><h2>Curriculum subjects</h2><p className="muted">{items.length} subject{items.length === 1 ? '' : 's'} · {items.reduce((sum,i) => sum+(coursesById.get(i.course_id)?.units ?? 0),0).toFixed(1)} units</p></div>
            {selected.status === 'draft' ? <button type="button" className="cm-publish" onClick={() => void onStatus('published')} disabled={working || !items.length}><CheckCircle2 size={15}/>Publish map</button>
              : selected.status === 'published' ? <button type="button" className="cm-retire" onClick={() => void onStatus('retired')} disabled={working}>Retire map</button> : <State status="retired"/>}
          </div>
          {isDraft && <form className="cm-add-subject" onSubmit={e => void onAddSubject(e)}>
            <Field title="Course (from academic catalog)"><select required value={subjectCourseId} onChange={e => setSubjectCourseId(e.target.value)}><option value="">Choose a subject</option>
              {availableCourses.map(c => <option key={c.id} value={c.id}>{courseLabel(c)} · {c.units} units</option>)}</select></Field>
            <Field title="Year"><select value={subjectYear} onChange={e => setSubjectYear(e.target.value)}>{[1,2,3,4,5].map(n => <option key={n} value={n}>Year {n}</option>)}</select></Field>
            <Field title="Semester"><select value={subjectSemester} onChange={e => setSubjectSemester(e.target.value as SemesterKey)}>
              {Object.entries(TERM_LABEL).map(([k,v]) => <option value={k} key={k}>{v}</option>)}</select></Field>
            <label className="cm-check"><input type="checkbox" checked={required} onChange={e => setRequired(e.target.checked)}/> Required subject</label>
            <button type="submit" className="button button-primary" disabled={working || !subjectCourseId}><Plus size={15}/>Add subject</button>
          </form>}
          {!items.length ? <div className="cm-empty"><CircleAlert size={18}/>No subjects in this curriculum. Add approved courses from the course catalog.</div> :
            <div className="cm-subject-list">{items.map(i => <article key={i.id} className="cm-subject">
              <div><strong>{itemLabel(i)}</strong><small>Year {i.year_level} · {TERM_LABEL[i.semester]} · {coursesById.get(i.course_id)?.units ?? '—'} units · {i.is_required ? 'Required' : 'Elective'}</small>
                {links.filter(l => l.curriculum_item_id === i.id).map(l => <div className="cm-dependency" key={l.id}><GitBranch size={13}/> Prerequisite: {itemLabel(itemsById.get(l.prerequisite_item_id))}
                  {isDraft && <button type="button" disabled={working} onClick={() => void run(() => removePrerequisite(l.id), 'Prerequisite removed.')} aria-label="Remove prerequisite"><Trash2 size={13}/></button>}</div>)}
              </div>{isDraft && <button type="button" className="cm-remove" disabled={working} title="Remove from draft" onClick={() => {
                if (window.confirm('Remove this subject from the draft curriculum? Remove its prerequisites first.')) void run(() => removeCurriculumItem(i.id), 'Subject removed.');
              }}><Trash2 size={15}/></button>}</article>)}</div>}
        </section>
        <aside className="surface-card cm-panel cm-prereq-panel"><h2>Prerequisite rules</h2><p className="muted">A subject must be completed before the selected subject. Add only rules from the approved curriculum map.</p>
          {isDraft && items.length > 1 ? <form className="cm-form" onSubmit={e => void onAddPrerequisite(e)}>
            <Field title="Subject requiring a prerequisite"><select value={target?.id ?? ''} onChange={e => {setTargetItemId(e.target.value);setPrereqItemId('');}}>
              {items.map(i => <option key={i.id} value={i.id}>{itemLabel(i)}</option>)}</select></Field>
            <Field title="Required prerequisite subject"><select required value={prereqItemId} onChange={e => setPrereqItemId(e.target.value)}><option value="">Choose a prerequisite</option>
              {prereqChoices.map(i => <option key={i.id} value={i.id}>{itemLabel(i)}</option>)}</select></Field>
            <button type="submit" className="button button-primary" disabled={working || !prereqItemId}><Plus size={15}/>Add prerequisite</button>
          </form> : <div className="cm-empty">{isDraft ? 'Add at least two subjects to define prerequisites.' : 'Published and retired maps are read-only.'}</div>}
          <div className="cm-help"><ShieldAlert size={16}/><span>The database validates that both subjects are in the same curriculum and rejects circular prerequisite chains. Prerequisite completion checks will be added during student subject assignment.</span></div>
          {selected.published_at && <p className="cm-date">Published: {new Date(selected.published_at).toLocaleString()}</p>}
        </aside>
      </div> : <div className="surface-card cm-alert"><CircleAlert size={18}/>Choose an academic program and create a draft curriculum to begin.</div>}
    </>}
  </>;
}
