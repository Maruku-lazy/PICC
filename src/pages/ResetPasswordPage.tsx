import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import './AuthPage.css';

/** The Supabase recovery link establishes a session; updateUser then changes
 * only the signed-in account's password. Configure /reset-password as an
 * allowed redirect URL in Supabase Authentication URL settings. */
export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [sessionReady, setSessionReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let mounted = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) { setSessionReady(!!session); setChecking(false); }
    });
    void supabase.auth.getSession().then(({ data, error: cause }) => {
      if (mounted) { setSessionReady(!!data.session && !cause); setChecking(false); }
    }).catch(() => { if (mounted) setChecking(false); });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    if (!sessionReady) { setError('Recovery link is missing or expired. Request another email.'); return; }
    if (password.length < 8) { setError('Use a new password of at least 8 characters.'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return; }
    setBusy(true);
    try {
      const { error: cause } = await supabase.auth.updateUser({ password });
      if (cause) throw cause;
      await supabase.auth.signOut();
      navigate('/login', { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Password could not be updated.');
    } finally { setBusy(false); }
  }
  return <main className="auth-page"><div className="auth-frame" style={{maxWidth:560,margin:'auto'}}>
    <section className="auth-form-panel" aria-label="Password recovery" style={{width:'100%'}}>
      <div className="auth-panel-content"><h1>Set a new password</h1>
        {checking ? <p role="status">Checking recovery link…</p>
          : !sessionReady ? <p role="alert">Recovery link is missing or expired. Request another from Sign in.</p>
          : <form className="auth-fields" onSubmit={submit}>
              <label className="auth-field"><span>New password</span><span className="auth-input-wrap">
                <input type="password" autoComplete="new-password" value={password}
                  onChange={e => setPassword(e.target.value)} required minLength={8}/></span></label>
              <label className="auth-field"><span>Confirm password</span><span className="auth-input-wrap">
                <input type="password" autoComplete="new-password" value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)} required minLength={8}/></span></label>
              {error && <p className="auth-notice auth-notice--error" role="alert">{error}</p>}
              <button className="auth-submit" disabled={busy} type="submit">{busy ? 'Updating…' : 'Update password'}</button>
            </form>}
        <p><Link to="/login" className="auth-inline-link">Back to sign in</Link></p>
      </div></section></div></main>;
}
