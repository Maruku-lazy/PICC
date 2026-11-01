import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpenCheck, CalendarClock, ChevronDown, Info, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { EnrollmentApplication } from '../types';
import { fetchEnrollmentOutcome } from '../services/enrollmentConfirmationService';
import { getAcademicCatalog, type AcademicCatalog } from '../services/academicService';
import { loadCurriculumData, type CurriculumData } from '../services/curriculumService';
import {
  assignStudentCourse, clearStudentTermPlan, eligibleOfferings, getMatchingTerm,
  loadAssignmentHistory, loadSectionAssignments, loadStudentAssignments,
  meetingLabel, overlappingMeetings, prerequisitesForCourse, removeStudentCourse, sectionHasRoom,
  type AssignmentHistory, type AssignmentView, type TermPlan,
} from '../services/assignmentService';
import './SubjectAssignments.css';

const EMPTY_ACADEMIC: AcademicCatalog = { terms: [], programs: [], courses: [], sections: [], offerings: [], meetings: [] };
const EMPTY_CURRICULA: CurriculumData = { versions: [], items: [], prerequisites: [] };

export default function RegistrarSubjectAssignment({ application }: { application: EnrollmentApplication }) {
  const [catalog, setCatalog] = useState<AcademicCatalog>(EMPTY_ACADEMIC);
  const [curricula, setCurricula] = useState<CurriculumData>(EMPTY_CURRICULA);
  const [plans, setPlans] = useState<TermPlan[]>([]);
  const [assigned, setAssigned] = useState<AssignmentView[]>([]);
  const [allAssigned, setAllAssigned] = useState<AssignmentView[]>([]);
  const [history, setHistory] = useState<AssignmentHistory[]>([]);
  const [selectedCurriculum, setSelectedCurriculum] = useState('');
  const [selectedOffering, setSelectedOffering] = useState('');
  const [prerequisiteNote, setPrerequisiteNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [finalized, setFinalized] = useState(false);

  const program = catalog.programs.find((entry) => entry.name === application.program && entry.active);
  const term = getMatchingTerm(catalog, application.academicYear, application.semester);
  const currentPlan = plans.find((entry) => entry.term_id === term?.id);
  const eligibleVersions = curricula.versions.filter((entry) => entry.program_id === program?.id &&
    entry.status === 'published' && entry.effective_academic_year <= application.academicYear);
  const curriculumId = currentPlan?.curriculum_id || selectedCurriculum;
  const activeCurriculum = eligibleVersions.find((entry) => entry.id === curriculumId);
  const yearLevel = Number(application.yearLevel);
  const choices = term && program && activeCurriculum ? eligibleOfferings(
    catalog, curricula.items, activeCurriculum.id, program.id, yearLevel, term.id, term.semester,
  ) : [];
  const selected = choices.find((entry) => entry.id === selectedOffering);
  const selectedCourse = selected && catalog.courses.find((entry) => entry.id === selected.course_id);
  const prerequisites = selected && activeCurriculum ? prerequisitesForCourse(
    curricula.items, curricula.prerequisites, activeCurriculum.id, selected.course_id,
  ) : [];
  const assignedCourseIds = new Set(assigned.filter((entry) => entry.term_id === term?.id).map((entry) => entry.course_id));
  const matchingMeetings = selected ? catalog.meetings.filter((entry) => entry.offering_id === selected.id && entry.active) : [];
  const conflicting = selected && assigned.some((entry) => entry.term_id === term?.id &&
    overlappingMeetings(matchingMeetings, catalog.meetings.filter((meeting) => meeting.offering_id === entry.offering_id && meeting.active)));
  const section = selected && catalog.sections.find((entry) => entry.id === selected.section_id);
  const sectionFull = section && !sectionHasRoom(section, allAssigned, application.id);
  const selectedAssigned = selected && assignedCourseIds.has(selected.course_id);
  const canAssign = Boolean(!finalized && ['submitted','under_review','documents_verified'].includes(application.status) && term && activeCurriculum && selected && matchingMeetings.length && !conflicting &&
    !sectionFull && !selectedAssigned && (!prerequisites.length || prerequisiteNote.trim().length >= 10));

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [academic, curriculum, own, trail, outcome] = await Promise.all([
        getAcademicCatalog(), loadCurriculumData(), loadStudentAssignments(application.id), loadAssignmentHistory(application.id),
        fetchEnrollmentOutcome(application.id),
      ]);
      const foundTerm = getMatchingTerm(academic, application.academicYear, application.semester);
      const occupied = foundTerm ? await loadSectionAssignments(foundTerm.id) : [];
      setCatalog(academic); setCurricula(curriculum); setPlans(own.plans);
      setAssigned(own.assignments); setAllAssigned(occupied); setHistory(trail); setFinalized(Boolean(outcome.confirmation)); setError('');
      const existingPlan = own.plans.find((entry) => entry.term_id === foundTerm?.id);
      if (existingPlan) setSelectedCurriculum(existingPlan.curriculum_id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load subject assignments.');
    } finally { setLoading(false); }
  }, [application.id, application.academicYear, application.semester]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { setSelectedOffering(''); setPrerequisiteNote(''); }, [selectedCurriculum]);

  const selectedMeetings = useMemo(() => assigned.filter((entry) => entry.term_id === term?.id).map((entry) => {
    const course = catalog.courses.find((part) => part.id === entry.course_id);
    const section = catalog.sections.find((part) => part.id === entry.section_id);
    const offering = catalog.offerings.find((part) => part.id === entry.offering_id);
    const meetings = catalog.meetings.filter((part) => part.offering_id === entry.offering_id && part.active)
      .sort((a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time));
    return { entry, course, section, offering, meetings };
  }), [assigned, catalog, term]);

  async function runTask(task: () => Promise<void>, message: string) {
    if (busy || finalized) return;
    setBusy(true); setError(''); setSuccess('');
    try {
      await task(); await reload(); setSelectedOffering(''); setPrerequisiteNote(''); setSuccess(message);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save.'); }
    finally { setBusy(false); }
  }

  async function onAssign() {
    if (!term || !activeCurriculum || !selected || !canAssign) return;
    await runTask(() => assignStudentCourse({
      applicationId: application.id, termId: term.id, curriculumId: activeCurriculum.id,
      offeringId: selected.id, prerequisiteNote: prerequisiteNote.trim(),
    }), 'Subject assigned. The student can now see the provisional schedule.');
  }
  async function onRemove(id: string) {
    if (finalized || !window.confirm('Remove this assigned subject from the student schedule? A history record will be kept.')) return;
    await runTask(() => removeStudentCourse(id), 'Subject removed. The action was recorded in assignment history.');
  }
  async function onClear() {
    if (finalized || !currentPlan || !window.confirm('Clear this empty curriculum plan so you can select a different version?')) return;
    await runTask(() => clearStudentTermPlan(currentPlan.id), 'Empty plan cleared. Select a published curriculum.');
    setSelectedCurriculum('');
  }

  return <section className="surface-card sa-panel" aria-label="Registrar subject assignment">
    <div className="section-heading"><div><div className="eyebrow">ACADEMIC MANAGEMENT</div><h2><BookOpenCheck size={19}/> Subject and section assignment</h2></div>
      <button type="button" className="sa-refresh" disabled={busy || loading} onClick={() => void reload()}><RefreshCw size={15}/> Refresh</button>
    </div>
    <p className="muted">Registrar-controlled subject assignments. Final enrollment confirmation is recorded separately.</p>
    {finalized && <div className="notice-success">Enrollment confirmed. This schedule is locked; any correction requires an authorized amendment workflow.</div>}
    {loading && <div className="sa-hint" role="status">Loading curricula and section capacity…</div>}
    {!['submitted','under_review','documents_verified'].includes(application.status) && <div className="sa-hint">New assignments are paused until this application is submitted and ready for Registrar review. Existing assignments may still be removed.</div>}
    {error && <div role="alert" className="notice-error">{error}</div>}
    {success && <div role="status" className="notice-success">{success}</div>}
    {!loading && !term && <div className="sa-empty"><Info size={18}/>No academic term matches the student application ({application.academicYear || 'missing year'}, {application.semester}). Create the matching term in Academic Management first.</div>}
    {!loading && term && !program && <div className="sa-empty"><Info size={18}/>The student's program must match an active Academic Management program. Correct it before assigning subjects.</div>}
    {!loading && term && program && <>
      <div className="sa-topline"><span><strong>Term:</strong> {term.academic_year} · {term.semester} semester</span><span><strong>Year:</strong> {application.yearLevel}</span><span><strong>Assigned:</strong> {selectedMeetings.length}</span></div>
      <div className="sa-field-grid">
        <label className="sa-field"><span>Published curriculum version</span>
          <select value={curriculumId} disabled={busy || finalized || Boolean(currentPlan)} onChange={(e) => setSelectedCurriculum(e.target.value)}>
            <option value="">Select published curriculum</option>
            {eligibleVersions.map((version) => <option value={version.id} key={version.id}>{version.version_name} ({version.effective_academic_year})</option>)}
          </select>
        </label>
        <label className="sa-field"><span>Available course & section</span>
          <select value={selectedOffering} disabled={busy || finalized || !activeCurriculum} onChange={(e) => {setSelectedOffering(e.target.value); setPrerequisiteNote('');}}>
            <option value="">Select a scheduled offering</option>
            {choices.map((offering) => {
              const course = catalog.courses.find((entry) => entry.id === offering.course_id);
              const section = catalog.sections.find((entry) => entry.id === offering.section_id);
              return <option key={offering.id} value={offering.id}>{course?.course_code} · {course?.title} — {section?.section_name}</option>;
            })}
          </select>
        </label>
      </div>
      {!eligibleVersions.length && <p className="sa-hint">No published curriculum is available for this program and academic year. Publish an institution-approved version first.</p>}
      {currentPlan && !selectedMeetings.length && <button type="button" className="sa-clear" disabled={busy || finalized} onClick={() => void onClear()}>Change curriculum (clear empty plan)</button>}
      {selected && <div className="sa-selection">
        <strong>{selectedCourse?.course_code} · {selectedCourse?.title}</strong>
        <p>{section?.section_name || 'Section'} · Capacity {section?.capacity ?? '—'} · {selectedCourse?.units ?? '—'} units</p>
        <div className="sa-times">{matchingMeetings.map((meeting) => <span key={meeting.id}>{meetingLabel(meeting.weekday, meeting.start_time, meeting.end_time, meeting.room)}</span>)}</div>
        {!matchingMeetings.length && <p className="sa-warning">This offering needs an active class meeting before assignment.</p>}
        {sectionFull && <p className="sa-warning">Section is full. Select another section.</p>}
        {conflicting && <p className="sa-warning">Schedule conflicts with an already assigned subject.</p>}
        {selectedAssigned && <p className="sa-warning">This course has already been assigned this term.</p>}
        {prerequisites.length > 0 && <label className="sa-field sa-prerequisite"><span>Prerequisite verification note (required)</span>
          <small>Prerequisites: {prerequisites.map((id) => catalog.courses.find((course) => course.id === id)?.course_code || 'Unknown course').join(', ')}. Confirm eligibility against records outside this system; this system has no verified grades yet.</small>
          <textarea rows={3} maxLength={500} value={prerequisiteNote} onChange={(e) => setPrerequisiteNote(e.target.value)} placeholder="E.g. Checked prior grades/transcript against required prerequisite."/>
        </label>}
        <button type="button" className="button button-primary" disabled={!canAssign || busy || finalized} onClick={() => void onAssign()}><Plus size={16}/>{busy ? 'Saving…' : 'Assign subject'}</button>
      </div>}
      <h3 className="sa-heading">Assigned subjects</h3>
      {!selectedMeetings.length ? <p className="sa-hint">No subjects assigned for this term yet.</p> : <div className="sa-list">{selectedMeetings.map(({entry,course,section,offering,meetings}) => <div className="sa-row" key={entry.id}>
        <div><strong>{course?.course_code || 'Course'} · {course?.title || 'Unknown course'}</strong>
          <small>{section?.section_name} · {course?.units ?? '—'} units · {offering?.instructor_name || 'Instructor not assigned'}</small>
          <div className="sa-times">{meetings.map((meeting) => <span key={meeting.id}>{meetingLabel(meeting.weekday,meeting.start_time,meeting.end_time,meeting.room)}</span>)}</div>
          {entry.prerequisite_note && <small>Prerequisite eligibility note recorded</small>}
        </div>
        <button type="button" className="sa-remove" disabled={busy || finalized} onClick={() => void onRemove(entry.id)} aria-label={`Remove ${course?.course_code || 'subject'}`}><Trash2 size={15}/> Remove</button>
      </div>)}</div>}
      <button type="button" className="sa-history-toggle" onClick={() => setShowHistory((value) => !value)} aria-expanded={showHistory}><CalendarClock size={15}/> Assignment activity ({history.length} recent entries) <ChevronDown size={15}/></button>
      {showHistory && <div className="sa-history">{history.length ? history.map((item) => <div key={item.id}>
        <span>{item.action === 'assigned' ? 'Assigned' : 'Removed'} · {catalog.courses.find((course) => course.id === item.course_id)?.course_code || 'Course'}</span>
        <small>{new Date(item.occurred_at).toLocaleString()}</small>
      </div>) : <p className="sa-hint">No assignment activity yet.</p>}</div>}
    </>}
    <div className="sa-hint"><Info size={15}/> Capacity, duplicate courses, schedule overlaps, and published-curriculum eligibility are checked again securely in Supabase. Final Registrar approval is a separate phase.</div>
  </section>;
}
