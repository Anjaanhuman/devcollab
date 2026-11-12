import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Code2, LockKeyhole } from 'lucide-react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import api, { getMessage } from '../services/api.js';

export default function AuthPage({ mode }) {
  const isRegister = mode === 'register';
  const isForgot = mode === 'forgot';
  const isReset = mode === 'reset';
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [form, setForm] = useState({ fullName: '', username: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [resetToken, setResetToken] = useState(params.get('token') || '');
  const [resetSuccess, setResetSuccess] = useState(false);
  const resetTokenFromUrl = params.get('token') || '';

  useEffect(() => {
    setMessage('');
    setError('');
    setResetSuccess(false);
    if (isReset && resetTokenFromUrl) setResetToken(resetTokenFromUrl);
    else if (!isReset) setResetToken('');
  }, [isReset, location.pathname, resetTokenFromUrl]);

  function update(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    setResetSuccess(false);
    try {
      if (isRegister) {
        await register(form);
        navigate('/app/dashboard', { replace: true });
      } else if (mode === 'login') {
        await login({ email: form.email, password: form.password });
        navigate(location.state?.from || '/app/dashboard', { replace: true });
      } else if (isForgot) {
        const { data } = await api.post('/auth/forgot-password', { email: form.email });
        if (data.data?.resetToken) setResetToken(data.data.resetToken);
        setMessage(data.message);
      } else if (isReset) {
        await api.put(`/auth/reset-password/${encodeURIComponent(resetToken)}`, { password: form.password });
        setMessage('Password updated. You can sign in now.');
        setResetSuccess(true);
      }
    } catch (requestError) {
      setError(getMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  const title = isRegister ? 'Make something together.' : isForgot ? 'Get back into your account.' : isReset ? 'Choose a new password.' : 'Welcome back.';
  const description = isRegister ? 'Create your DEVCOLLAB account and find your next team.' : isForgot ? 'We’ll prepare a secure password reset link for your account.' : isReset ? 'Set a fresh password to secure your account.' : 'Sign in to pick up where your team left off.';

  return (
    <main className="auth-page">
      <Link className="auth-back" to="/"><ArrowLeft size={15} /> Back to DEVCOLLAB</Link>
      <section className="auth-card">
        <div className="auth-brand"><span className="auth-brand-icon"><Code2 size={18} /></span><span>DEVCOLLAB</span></div>
        <div className="auth-copy"><span className="eyebrow">YOUR WORKSPACE, READY</span><h1>{title}</h1><p>{description}</p></div>
        <form className="auth-form" onSubmit={submit}>
          {isRegister && <>
            <label>Full name<input name="fullName" value={form.fullName} onChange={update} autoComplete="name" minLength={2} maxLength={80} required /></label>
            <label>Username<input name="username" value={form.username} onChange={update} autoComplete="username" pattern="[a-zA-Z0-9_]{3,30}" minLength={3} maxLength={30} required /><small>Letters, numbers, and underscores.</small></label>
          </>}
          {(mode === 'login' || isRegister || isForgot) && <label>Email address<input type="email" name="email" value={form.email} onChange={update} autoComplete="email" maxLength={254} required /></label>}
          {isReset && <label>Reset token<input value={resetToken} onChange={(event) => setResetToken(event.target.value)} autoComplete="off" required /><small>Use the token from your email or development response.</small></label>}
          {(mode === 'login' || isRegister || isReset) && <label>{isReset ? 'New password' : 'Password'}<input type="password" name="password" value={form.password} onChange={update} autoComplete={isRegister || isReset ? 'new-password' : 'current-password'} minLength={mode === 'login' ? undefined : 8} maxLength={72} required />{mode !== 'login' && <small>Use at least 8 characters.</small>}</label>}
          {mode === 'login' && <div className="auth-form-row"><span><LockKeyhole size={13} /> Secure, private session</span><Link to="/forgot-password">Forgot password?</Link></div>}
          {error && <div className="form-alert form-alert-error" role="alert">{error}</div>}
          {message && <div className="form-alert" role="status">{message}{resetToken && isForgot && <><br /><small>Development reset token: <code>{resetToken}</code> <Link to={`/reset-password?token=${encodeURIComponent(resetToken)}`}>Reset password <ArrowRight size={12} /></Link></small></>}</div>}
          {!(isReset && resetSuccess) && <button className="button auth-submit" type="submit" disabled={busy}>{busy ? 'Please wait…' : isRegister ? 'Create account' : isForgot ? 'Prepare reset link' : isReset ? 'Save new password' : 'Sign in'} <ArrowRight size={15} /></button>}
        </form>
        <div className="auth-footnote">{isRegister ? <>Already have an account? <Link to="/login">Sign in</Link></> : mode === 'login' ? <>New to DEVCOLLAB? <Link to="/register">Create an account</Link></> : <Link to="/login">Back to sign in</Link>}</div>
      </section>
      <p className="auth-legal">A focused place to find your people and build useful things.</p>
    </main>
  );
}
