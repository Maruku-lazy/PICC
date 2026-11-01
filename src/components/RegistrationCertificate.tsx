import { Printer } from 'lucide-react';
import { WEEKDAYS } from '../services/academicService';
import type { EnrollmentConfirmation } from '../services/enrollmentConfirmationService';
import { peso } from '../services/enrollmentConfirmationService';
import './EnrollmentConfirmation.css';

const dayLabel = (weekday: number) => WEEKDAYS[weekday - 1] || `Day ${weekday}`;
const trimTime = (value: string) => String(value).slice(0, 5);

export default function RegistrationCertificate({ confirmation }: { confirmation: EnrollmentConfirmation }) {
  const data = confirmation.registration_snapshot;
  return <section className="ec-certificate-wrapper" aria-label="Development registration record">
    <div className="ec-certificate-toolbar">
      <p className="muted">Confirmed enrollment record. Print a <strong>development COR draft</strong>; the official PiCC COR template requires school approval.</p>
      <button type="button" className="button button-primary" onClick={() => window.print()}><Printer size={16}/> Print COR draft / Save as PDF</button>
    </div>
    <article className="ec-certificate" id="picc-print-certificate">
      <div className="ec-certificate-banner">DEVELOPMENT TEMPLATE • NOT AN OFFICIAL PiCC CERTIFICATE</div>
      <header className="ec-certificate-heading">
        <strong>Pilar Community College</strong>
        <h2>Certificate of Registration — Draft</h2>
        <p>System-generated enrollment confirmation record</p>
      </header>
      <div className="ec-certificate-meta">
        <div><small>Registration reference</small><strong>{confirmation.registration_reference}</strong></div>
        <div><small>Confirmed at</small><strong>{new Date(confirmation.confirmed_at).toLocaleString('en-PH')}</strong></div>
        <div><small>Student name</small><strong>{data.studentName}</strong></div>
        <div><small>Program</small><strong>{data.program}</strong></div>
        <div><small>Academic term</small><strong>{data.academicYear} · {data.semester} semester</strong></div>
        <div><small>Year / curriculum</small><strong>Year {data.yearLevel} · {data.curriculum}</strong></div>
      </div>
      <h3>Registered subjects</h3>
      <div className="ec-table-wrap"><table className="ec-table"><thead><tr>
        <th>Code</th><th>Course title</th><th>Units</th><th>Section</th><th>Instructor / schedule</th>
      </tr></thead><tbody>{data.courses.map((course, i) => <tr key={`${course.courseCode}-${i}`}>
        <td>{course.courseCode}</td><td>{course.title}</td><td>{course.units}</td><td>{course.section}</td>
        <td>{course.instructor || 'Not specified'}
          <div className="ec-meetings">{course.meetings.map((meeting, j) =>
            <div key={j}>{dayLabel(meeting.weekday)} {trimTime(meeting.start)}–{trimTime(meeting.end)} · {meeting.room || 'Room TBA'}</div>)}</div>
        </td>
      </tr>)}</tbody></table></div>
      <div className="ec-totals"><span>{data.courseCount} subject(s) · {data.totalUnits} total units</span>
        <span>Assessment: {peso(data.assessmentAmount)} · {data.paymentStatus === 'waived' ? 'Documented waiver' : 'Payment verified externally'}</span>
      </div>
      <footer className="ec-certificate-footer">This is a development printout from a fictional-data test environment. It is not a payment receipt, an official school-issued document, or proof of graduation.</footer>
    </article>
  </section>;
}
