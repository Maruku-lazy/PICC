import { useEffect, useMemo, useState } from 'react';
import { BookOpenCheck, CalendarClock, Info } from 'lucide-react';
import { useDemo } from '../context/DemoContext';
import { getAcademicCatalog, type AcademicCatalog } from '../services/academicService';
import { loadStudentAssignments, meetingLabel, type AssignmentView } from '../services/assignmentService';
import './SubjectAssignments.css';

const EMPTY: AcademicCatalog = { terms: [], programs: [], courses: [], sections: [], offerings: [], meetings: [] };
export default function StudentSchedulePanel({ applicationId }: { applicationId: string }) {
  const { isSupabase } = useDemo();
  const [catalog, setCatalog] = useState<AcademicCatalog>(EMPTY);
  const [records, setRecords] = useState<AssignmentView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!isSupabase) { setLoading(false); return; }
    let live = true;
    setLoading(true);
    Promise.all([getAcademicCatalog(), loadStudentAssignments(applicationId)])
      .then(([academic, allocation]) => { if (live) { setCatalog(academic); setRecords(allocation.assignments); } })
      .catch((cause: unknown) => { if (live) setError(cause instanceof Error ? cause.message : 'Unable to load assigned schedule.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [applicationId, isSupabase]);
  const subjects = useMemo(() => records.map((record) => {
    const course = catalog.courses.find((entry) => entry.id === record.course_id);
    const section = catalog.sections.find((entry) => entry.id === record.section_id);
    const meetings = catalog.meetings.filter((entry) => entry.offering_id === record.offering_id && entry.active)
      .sort((a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time));
    return { ...record, course, section, meetings };
  }), [records, catalog]);
  if (!isSupabase) return null;
  return <section className="surface-card sa-student-panel">
    <div className="section-heading"><div><div className="eyebrow">ACADEMIC ASSIGNMENT</div><h2><BookOpenCheck size={19} /> Your assigned class schedule</h2></div></div>
    <p className="muted">Registrar-assigned subjects only. Assignments are provisional until the Registrar confirms enrollment. See the confirmation section below for final status.</p>
    {loading && <p className="sa-hint" role="status">Loading assigned subjects…</p>}
    {error && <div className="notice-error" role="alert">{error}</div>}
    {!loading && !error && !subjects.length && <div className="sa-empty"><CalendarClock size={19}/>No subjects assigned yet. The Registrar will prepare your schedule after application review.</div>}
    {subjects.length > 0 && <div className="sa-student-list">
      {subjects.map((record) => <div className="sa-student-row" key={record.id}>
        <strong>{record.course?.course_code || 'Course'} · {record.course?.title || 'Course unavailable'}</strong>
        <small>{record.section?.section_name || 'Section'} · {record.course?.units ?? '—'} units</small>
        <div className="sa-times">{record.meetings.map((meeting) => <span key={meeting.id}>{meetingLabel(meeting.weekday, meeting.start_time, meeting.end_time, meeting.room)}</span>)}
          {!record.meetings.length && <span>Schedule to be confirmed</span>}
        </div>
      </div>)}
    </div>}
    <div className="sa-hint"><Info size={15} /> Subject eligibility and prerequisites require Registrar checking. Final confirmation and payment verification are separate steps.</div>
  </section>;
}
