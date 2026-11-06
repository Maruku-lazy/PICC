import { useState, type FormEvent } from 'react';
import {
  ArrowLeft, ArrowRight, BookOpenCheck, CheckCircle2, ChevronRight,
  ClipboardCheck, Eye, EyeOff, GraduationCap, LockKeyhole,
  Mail, ShieldCheck, UserRound, UserRoundPlus,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useDemo } from '../context/DemoContext';
import type { DemoRole } from '../types';
import './AuthPage.css';

type FormMode = 'login' | 'signup';
type Notice = { kind: 'error' | 'info' | 'success'; text: string } | null;

// LOCAL FRONTEND DEMO ONLY. These credentials never contact a backend.
// Replace this entire credential check with a real authenticated service later.
const DEMO_USERS: Record<DemoRole, { email: string; password: string }> = {
  student: { email: 'student@picc.test', password: 'Student123!' },
  registrar: { email: 'registrar@picc.test', password: 'Registrar123!' },
};

export default function LoginPage() {
  const navigate = useNavigate();
  const { login, register, isSupabase, resetPassword } = useDemo();
  const [role, setRole] = useState<DemoRole | null>(null);
  const [mode, setMode] = useState<FormMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [logoUnavailable, setLogoUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);

  const demoEnabled = !isSupabase && import.meta.env.DEV;
  const label = role === 'registrar' ? 'Registrar' : 'Student';

  function chooseRole(nextRole: DemoRole) {
    setRole(nextRole);
    setMode('login');
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setFullName('');
    setShowPassword(false);
    setNotice(null);
  }

  function changeMode(nextMode: FormMode) {
    setMode(nextMode);
    setNotice(null);
    setPassword('');
    setConfirmPassword('');
    setShowPassword(false);
  }

  function fillDemoCredentials() {
    if (!role || !demoEnabled) return;
    setMode('login');
    setEmail(DEMO_USERS[role].email);
    setPassword(DEMO_USERS[role].password);
    setNotice(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!role || busy) return;
    setNotice(null);

    if (mode === 'signup') {
      if (role === 'registrar') {
        setNotice({ kind: 'error', text: 'Registrar accounts are created by an authorized administrator.' });
        return;
      }
      if (fullName.trim().length < 2) {
        setNotice({ kind: 'error', text: 'Please enter your full name.' }); return;
      }
      if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
        setNotice({ kind: 'error', text: 'Please enter a valid email address.' }); return;
      }
      if (password.length < 8) {
        setNotice({ kind: 'error', text: 'Password must contain at least 8 characters.' }); return;
      }
      if (password !== confirmPassword) {
        setNotice({ kind: 'error', text: 'The passwords do not match.' }); return;
      }
      if (!isSupabase) {
        setNotice({ kind: 'info', text: 'Registration is a visual preview in demo mode.' });
        return;
      }
      setBusy(true);
      try {
        const message = await register(role, fullName, email.trim(), password);
        setNotice({ kind: 'success', text: message });
        setPassword(''); setConfirmPassword('');
      } catch (error) {
        setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Registration failed.' });
      } finally { setBusy(false); }
      return;
    }

    if (demoEnabled) {
      const demoUser = DEMO_USERS[role];
      if (email.trim().toLowerCase() !== demoUser.email || password !== demoUser.password) {
        setNotice({ kind: 'error', text: 'Incorrect demo email or password. Use “Fill demo credentials”.' });
        return;
      }
    }
    if (!isSupabase && !demoEnabled) {
      setNotice({ kind: 'error', text: 'Demo sign-in is disabled in production. Configure Supabase mode.' });
      return;
    }
    setBusy(true);
    try {
      await login(role, email.trim(), password);
      navigate(`/${role}/dashboard`, { replace: true });
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Sign-in failed.' });
    } finally { setBusy(false); }
  }

  async function handlePasswordReset() {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setNotice({ kind: 'error', text: 'Enter your email address before requesting a reset.' }); return;
    }
    setBusy(true);
    try {
      await resetPassword(email);
      setNotice({ kind: 'info', text: 'If that account exists, a password recovery link will be sent. Check your email.' });
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Could not request password recovery.' });
    } finally { setBusy(false); }
  }

  return (
    <main className="auth-page">
      <div className="auth-frame">
        <section className="auth-brand-panel" aria-label="Pilar Community College">
          <div className="auth-brand-header">
            <div className="auth-logo-slot" title="PiCC school logo">
              {logoUnavailable ? (
                <GraduationCap size={30} strokeWidth={1.7} aria-hidden="true" />
              ) : (
                <img
                  src="/images/picc-logo.jpg"
                  alt="PiCC school logo"
                  onError={() => setLogoUnavailable(true)}
                />
              )}
            </div>
            <div className="auth-school-name">
              <strong>Pilar Community College</strong>
              <span>Pilar, Sorsogon · Philippines</span>
            </div>
          </div>

          <div className="auth-brand-content">
            <div className="auth-brand-kicker"><span /> YOUR CAMPUS, CONNECTED</div>
            <h1>Making every enrollment step feel easier.</h1>
            <p>
              A unified space for students and the Registrar’s Office to manage applications,
              follow enrollment progress, and stay informed.
            </p>
            <div className="auth-brand-divider" />
            <div className="auth-brand-benefits">
              <span><ClipboardCheck size={18} aria-hidden="true" /> Guided applications</span>
              <span><BookOpenCheck size={18} aria-hidden="true" /> Academic information</span>
              <span><ShieldCheck size={18} aria-hidden="true" /> Registrar review</span>
            </div>
          </div>

          <div className="auth-brand-footer">
            <span className="auth-gold-dot" /> Enrollment Management System
          </div>
        </section>

        <section className="auth-form-panel" aria-label="Account access">
          <div className="auth-panel-topline">
            <span className="auth-panel-eyebrow">PiCC ONLINE SERVICES</span>
            <span className="auth-panel-step">{role ? '02 / 02' : '01 / 02'}</span>
          </div>

          {!role ? (
            <div className="auth-panel-content" key="select-role">
              <div className="auth-heading-icon"><GraduationCap size={23} aria-hidden="true" /></div>
              <h2>Welcome to PiCC</h2>
              <p className="auth-lead">Choose how you’d like to continue to the Enrollment Management System.</p>
              <div className="auth-role-options">
                <button type="button" className="auth-role-card" onClick={() => chooseRole('student')}>
                  <span className="auth-role-icon"><GraduationCap size={25} aria-hidden="true" /></span>
                  <span className="auth-role-copy"><strong>Continue as Student</strong><small>Start an application and track your enrollment.</small></span>
                  <ChevronRight size={21} aria-hidden="true" />
                </button>
                <button type="button" className="auth-role-card" onClick={() => chooseRole('registrar')}>
                  <span className="auth-role-icon auth-role-icon--registrar"><ClipboardCheck size={24} aria-hidden="true" /></span>
                  <span className="auth-role-copy"><strong>Continue as Registrar</strong><small>Review applications and manage submissions.</small></span>
                  <ChevronRight size={21} aria-hidden="true" />
                </button>
              </div>
              <p className="auth-role-footnote"><LockKeyhole size={14} aria-hidden="true" /> A separate sign-in form opens after you select your role.</p>
            </div>
          ) : (
            <div className="auth-panel-content" key={`${role}-${mode}`}>
              <button className="auth-back" type="button" onClick={() => { setRole(null); setNotice(null); }}>
                <ArrowLeft size={16} aria-hidden="true" /> Back to role selection
              </button>
              <div className="auth-selected-role">
                {role === 'student' ? <GraduationCap size={16} aria-hidden="true" /> : <ClipboardCheck size={16} aria-hidden="true" />}
                {label} Portal
              </div>
              <h2>{mode === 'login' ? `Sign in as ${label}` : `Create a ${label} account`}</h2>
              <p className="auth-lead">{mode === 'login' ? 'Enter your account details to continue.' : 'Create a student account to begin enrollment.'}</p>

              <div className="auth-tabs" role="group" aria-label="Authentication form">
                <button type="button" className={mode === 'login' ? 'auth-tab active' : 'auth-tab'} onClick={() => changeMode('login')} aria-pressed={mode === 'login'}>Sign in</button>
                <button type="button" className={mode === 'signup' ? 'auth-tab active' : 'auth-tab'} onClick={() => changeMode('signup')} aria-pressed={mode === 'signup'} disabled={role === 'registrar'} title={role === 'registrar' ? 'Registrar accounts are administrator-created' : undefined}>Sign up</button>
              </div>

              <form className="auth-fields" onSubmit={handleSubmit} noValidate>
                {mode === 'signup' && (
                  <label className="auth-field">
                    <span>Full name</span>
                    <span className="auth-input-wrap"><UserRound size={17} aria-hidden="true" /><input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Juan Dela Cruz" autoComplete="name" required /></span>
                  </label>
                )}
                <label className="auth-field">
                  <span>Email address</span>
                  <span className="auth-input-wrap"><Mail size={17} aria-hidden="true" /><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" autoComplete="email" required /></span>
                </label>
                <label className="auth-field">
                  <span>Password</span>
                  <span className="auth-input-wrap"><LockKeyhole size={17} aria-hidden="true" /><input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required /><button type="button" className="auth-toggle-visibility" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span>
                </label>
                {mode === 'signup' && (
                  <label className="auth-field">
                    <span>Confirm password</span>
                    <span className="auth-input-wrap"><LockKeyhole size={17} aria-hidden="true" /><input type={showPassword ? 'text' : 'password'} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Re-enter your password" autoComplete="new-password" required /></span>
                  </label>
                )}
                {mode === 'login' && (
                  <div className="auth-forgot-row">
                    <button type="button" className="auth-inline-link" onClick={() => void handlePasswordReset()}>Forgot password?</button>
                  </div>
                )}
                {notice && <div className={`auth-notice auth-notice--${notice.kind}`} role="status">{notice.kind === 'success' && <CheckCircle2 size={17} aria-hidden="true" />}<span>{notice.text}</span></div>}
                <button className="auth-submit" type="submit" disabled={busy}>
                  {busy ? 'Please wait…' : mode === 'login' ? `Sign in to ${label} Portal` : 'Create Student account'}
                  {mode === 'login' ? <ArrowRight size={18} aria-hidden="true" /> : <UserRoundPlus size={18} aria-hidden="true" />}
                </button>
              </form>

              {mode === 'login' && demoEnabled && (
                <div className="auth-demo-help">
                  <div><strong>Local development access</strong><small>No Supabase account or registrar approval needed.</small></div>
                  <button type="button" onClick={fillDemoCredentials}>Fill demo credentials</button>
                </div>
              )}
              {mode === 'signup' && <p className="auth-signup-note">Registrar accounts are provisioned separately. In Supabase mode, students may need to confirm their email address.</p>}
            </div>
          )}

          <div className="auth-panel-footer"><span>{isSupabase ? 'Development database · Use fictional student data only' : 'Frontend prototype only · Do not use real student data'}</span><span>© PiCC</span></div>
        </section>
      </div>
      <p className="auth-page-caption">Pilar Community College · Enrollment Management System</p>
    </main>
  );
}
