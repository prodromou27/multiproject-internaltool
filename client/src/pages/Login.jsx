import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Mail, Lock, AlertCircle, ArrowRight, Loader2, ShieldCheck, Eye, EyeOff, KeyRound, CheckCircle2, RotateCcw } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../App';

export default function Login() {
  const { login } = useAuth();
  const navigate  = useNavigate();
  const [searchParams] = useSearchParams();

  // Step 1: credentials
  const [form,    setForm]    = useState({ email: '', password: '' });
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);

  const [showPw, setShowPw] = useState(false);

  // Steps: 'login' | '2fa' | 'set_password' | 'forgot_email' | 'forgot_sent' | 'reset_password'
  const [step,         setStep]         = useState('login');
  const [partialToken, setPartialToken] = useState('');
  const [code,         setCode]         = useState('');
  const codeRef = useRef(null);

  // Forced password change (first-time or expired)
  const [pendingUser,     setPendingUser]     = useState(null);
  const [pendingToken,    setPendingToken]    = useState('');
  const [isExpired,       setIsExpired]       = useState(false); // true = expired, false = first-time
  const [newPw,           setNewPw]           = useState('');
  const [confirmPw,       setConfirmPw]       = useState('');
  const [showNewPw,       setShowNewPw]       = useState(false);

  // Forgot / reset password
  const [forgotEmail,  setForgotEmail]  = useState('');
  const [resetToken,   setResetToken]   = useState('');
  const [resetNewPw,   setResetNewPw]   = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [showResetPw,  setShowResetPw]  = useState(false);

  // On mount: check URL for reset_token param
  useEffect(() => {
    const token = searchParams.get('reset_token');
    if (token) { setResetToken(token); setStep('reset_password'); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  function finishLogin(user, token, must_change_password, password_expired) {
    if (must_change_password) {
      setPendingUser(user);
      setPendingToken(token);
      setIsExpired(!!password_expired);
      localStorage.setItem('token', token);
      setStep('set_password');
    } else {
      login(user, token);
      navigate('/');
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const res = await api.login(form.email, form.password);
      if (res.requires_2fa) {
        setPartialToken(res.partial_token);
        setStep('2fa');
        setTimeout(() => codeRef.current?.focus(), 100);
      } else {
        finishLogin(res.user, res.token, res.must_change_password, res.password_expired);
      }
    } catch (err) {
      setError(err.message || 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  }

  async function handle2FA(e) {
    e.preventDefault();
    if (!code.trim()) return;
    setError(''); setLoading(true);
    try {
      const res = await api.verify2fa(partialToken, code.replace(/\s/g, ''));
      finishLogin(res.user, res.token, res.must_change_password, res.password_expired);
    } catch (err) {
      setError(err.message || 'Invalid authentication code');
      setCode('');
      setTimeout(() => codeRef.current?.focus(), 50);
    } finally {
      setLoading(false);
    }
  }

  async function handleSetPassword(e) {
    e.preventDefault();
    if (newPw.length < 12) { setError('Password must be at least 12 characters'); return; }
    if (newPw !== confirmPw) { setError('Passwords do not match'); return; }
    setError(''); setLoading(true);
    try {
      await api.firstTimeChangePassword(newPw);
      localStorage.removeItem('token');
      login(pendingUser, pendingToken);
      navigate('/');
    } catch (err) {
      setError(err.message || 'Failed to set password');
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword(e) {
    e.preventDefault();
    if (!forgotEmail.trim()) return;
    setError(''); setLoading(true);
    try {
      await api.forgotPassword(forgotEmail.trim());
      setStep('forgot_sent');
    } catch (err) {
      setError(err.message || 'Failed to send reset email');
    } finally {
      setLoading(false);
    }
  }

  async function handleResetPassword(e) {
    e.preventDefault();
    if (resetNewPw.length < 12) { setError('Password must be at least 12 characters'); return; }
    if (resetNewPw !== resetConfirm) { setError('Passwords do not match'); return; }
    setError(''); setLoading(true);
    try {
      await api.resetPassword(resetToken, resetNewPw);
      setStep('login');
      setResetToken(''); setResetNewPw(''); setResetConfirm('');
      setError('');
      // Show a success message by temporarily using error state with a success style
      // We'll navigate to login with a flash message instead
      window.history.replaceState({}, '', '/login'); // remove token from URL
    } catch (err) {
      setError(err.message || 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">

      {/* Card */}
      <div className="login-card">

        {/* Logo */}
        <div className="login-logo-area">
          <img src="/odyssey_new.png" alt="Odyssey Cybersecurity" className="login-logo-img" />
        </div>

        {/* Brand title */}
        <h1 className="login-app-title">Solutions<span>Hub</span></h1>
        <p className="login-app-sub">Project &amp; Operations Management Platform</p>

        {/* Red rule */}
        <div className="login-rule" />

        {/* Error */}
        {error && (
          <div className="error-msg" style={{ marginBottom: 16 }}>
            <AlertCircle size={14} style={{ flexShrink: 0 }} />
            {error}
          </div>
        )}

        {/* ── Step 1: Email + Password ── */}
        {step === 'login' && (
          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label>Email Address</label>
              <div style={{ position: 'relative' }}>
                <Mail size={14} style={{
                  position: 'absolute', left: 11, top: '50%',
                  transform: 'translateY(-50%)', color: 'var(--gray-400)', pointerEvents: 'none',
                }} />
                <input
                  type="email"
                  value={form.email}
                  onChange={set('email')}
                  placeholder="you@odysseycs.com"
                  style={{ paddingLeft: 32 }}
                  required
                  autoFocus
                />
              </div>
            </div>

            <div className="form-group">
              <label>Password</label>
              <div style={{ position: 'relative' }}>
                <Lock size={14} style={{
                  position: 'absolute', left: 11, top: '50%',
                  transform: 'translateY(-50%)', color: 'var(--gray-400)', pointerEvents: 'none',
                }} />
                <input
                  type={showPw ? 'text' : 'password'}
                  value={form.password}
                  onChange={set('password')}
                  placeholder="••••••••"
                  style={{ paddingLeft: 32, paddingRight: 36 }}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  style={{
                    position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-400)',
                    padding: 2, display: 'flex', alignItems: 'center',
                  }}
                  tabIndex={-1}
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                >
                  {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="login-submit-btn"
            >
              {loading
                ? <><Loader2 size={14} className="login-spin" /> Signing in…</>
                : <><ArrowRight size={14} /> Sign In</>
              }
            </button>

            <div style={{ textAlign: 'center', marginTop: 12 }}>
              <button
                type="button"
                onClick={() => { setStep('forgot_email'); setForgotEmail(form.email); setError(''); }}
                style={{ background: 'none', border: 'none', color: 'var(--primary)', fontSize: 12, cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
              >
                Forgot your password?
              </button>
            </div>
          </form>
        )}

        {/* ── Step 2: TOTP code ── */}
        {step === '2fa' && (
          <form onSubmit={handle2FA}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#eff6ff', border: '2px solid #3b82f6',
                display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                <ShieldCheck size={26} color="#3b82f6" />
              </div>
              <div style={{ fontWeight: 700, fontSize: 16, color: '#1e3a5f', marginBottom: 4 }}>Two-Factor Authentication</div>
              <div style={{ fontSize: 13, color: 'var(--gray-500)' }}>
                Enter the 6-digit code from your authenticator app.
              </div>
            </div>

            <div className="form-group">
              <label>Authentication Code</label>
              <input
                ref={codeRef}
                type="text"
                inputMode="numeric"
                value={code}
                onChange={e => setCode(e.target.value.replace(/[^0-9 ]/g, '').slice(0, 7))}
                placeholder="000 000"
                style={{ textAlign: 'center', fontSize: 22, letterSpacing: '0.25em', fontWeight: 700 }}
                maxLength={7}
                autoComplete="one-time-code"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading || code.replace(/\s/g,'').length < 6}
              className="login-submit-btn"
            >
              {loading
                ? <><Loader2 size={14} className="login-spin" /> Verifying…</>
                : <><ShieldCheck size={14} /> Verify</>
              }
            </button>

            <button
              type="button"
              style={{ width: '100%', marginTop: 8, background: 'none', border: 'none', color: 'var(--gray-400)', fontSize: 12, cursor: 'pointer' }}
              onClick={() => { setStep('login'); setCode(''); setError(''); }}
            >
              ← Back to login
            </button>
          </form>
        )}

        {/* ── Step 3: Set password on first login ── */}
        {step === 'set_password' && (
          <form onSubmit={handleSetPassword}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#f0fdf4', border: '2px solid #22c55e',
                display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                <KeyRound size={26} color="#22c55e" />
              </div>
              <div style={{ fontWeight: 700, fontSize: 16, color: '#1e3a5f', marginBottom: 4 }}>
                {isExpired ? 'Password Expired' : 'Set Your Password'}
              </div>
              <div style={{ fontSize: 13, color: 'var(--gray-500)' }}>
                {isExpired
                  ? `Your password has expired, ${pendingUser?.name}. Please set a new one to continue.`
                  : `Welcome, ${pendingUser?.name}! Choose a personal password to continue.`}
              </div>
            </div>

            <div className="form-group">
              <label>New Password <span style={{ color: '#6b7280', fontWeight: 400, fontSize: 11 }}>(min. 12 characters)</span></label>
              <div style={{ position: 'relative' }}>
                <Lock size={14} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--gray-400)', pointerEvents: 'none' }} />
                <input
                  type={showNewPw ? 'text' : 'password'}
                  value={newPw}
                  onChange={e => setNewPw(e.target.value)}
                  placeholder="••••••••••••"
                  style={{ paddingLeft: 32, paddingRight: 36 }}
                  required
                  autoFocus
                  minLength={12}
                />
                <button type="button" onClick={() => setShowNewPw(v => !v)}
                  style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-400)', padding: 2, display: 'flex', alignItems: 'center' }}
                  tabIndex={-1}>
                  {showNewPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <div className="form-group">
              <label>Confirm Password</label>
              <div style={{ position: 'relative' }}>
                <Lock size={14} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--gray-400)', pointerEvents: 'none' }} />
                <input
                  type={showNewPw ? 'text' : 'password'}
                  value={confirmPw}
                  onChange={e => setConfirmPw(e.target.value)}
                  placeholder="••••••••••••"
                  style={{ paddingLeft: 32, borderColor: confirmPw && confirmPw !== newPw ? '#ef4444' : undefined }}
                  required
                />
              </div>
              {confirmPw && confirmPw !== newPw && (
                <div style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>Passwords do not match</div>
              )}
              {confirmPw && confirmPw === newPw && newPw.length >= 12 && (
                <div style={{ fontSize: 11, color: '#22c55e', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <CheckCircle2 size={11} /> Passwords match
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={loading || newPw.length < 12 || newPw !== confirmPw}
              className="login-submit-btn"
            >
              {loading
                ? <><Loader2 size={14} className="login-spin" /> Saving…</>
                : <><KeyRound size={14} /> Set Password &amp; Sign In</>
              }
            </button>
          </form>
        )}

        {/* ── Forgot password: enter email ── */}
        {step === 'forgot_email' && (
          <form onSubmit={handleForgotPassword}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#eff6ff', border: '2px solid #3b82f6',
                display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                <RotateCcw size={24} color="#3b82f6" />
              </div>
              <div style={{ fontWeight: 700, fontSize: 16, color: '#1e3a5f', marginBottom: 4 }}>Reset Password</div>
              <div style={{ fontSize: 13, color: 'var(--gray-500)' }}>
                Enter your email and we'll send you a reset link.
              </div>
            </div>
            <div className="form-group">
              <label>Email Address</label>
              <div style={{ position: 'relative' }}>
                <Mail size={14} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--gray-400)', pointerEvents: 'none' }} />
                <input type="email" value={forgotEmail} onChange={e => setForgotEmail(e.target.value)}
                  placeholder="you@company.com" style={{ paddingLeft: 32 }} required autoFocus />
              </div>
            </div>
            <button type="submit" disabled={loading || !forgotEmail.trim()} className="login-submit-btn">
              {loading ? <><Loader2 size={14} className="login-spin" /> Sending…</> : <><ArrowRight size={14} /> Send Reset Link</>}
            </button>
            <button type="button" style={{ width: '100%', marginTop: 8, background: 'none', border: 'none', color: 'var(--gray-400)', fontSize: 12, cursor: 'pointer' }}
              onClick={() => { setStep('login'); setError(''); }}>← Back to login</button>
          </form>
        )}

        {/* ── Forgot password: confirmation ── */}
        {step === 'forgot_sent' && (
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <CheckCircle2 size={48} color="#22c55e" strokeWidth={1.5} style={{ margin: '0 auto 12px', display: 'block' }} />
            <div style={{ fontWeight: 700, fontSize: 16, color: '#1e3a5f', marginBottom: 8 }}>Check your email</div>
            <div style={{ fontSize: 13, color: 'var(--gray-500)', marginBottom: 20 }}>
              If an account exists for <strong>{forgotEmail}</strong>, you'll receive a reset link within a few minutes. The link expires in 1 hour.
            </div>
            <button className="login-submit-btn" onClick={() => { setStep('login'); setForgotEmail(''); }}>
              <ArrowRight size={14} /> Back to Login
            </button>
          </div>
        )}

        {/* ── Reset password: from email link ── */}
        {step === 'reset_password' && (
          <form onSubmit={handleResetPassword}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#f0fdf4', border: '2px solid #22c55e',
                display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                <KeyRound size={26} color="#22c55e" />
              </div>
              <div style={{ fontWeight: 700, fontSize: 16, color: '#1e3a5f', marginBottom: 4 }}>Set New Password</div>
              <div style={{ fontSize: 13, color: 'var(--gray-500)' }}>Choose a strong password (min. 12 characters).</div>
            </div>
            <div className="form-group">
              <label>New Password</label>
              <div style={{ position: 'relative' }}>
                <Lock size={14} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--gray-400)', pointerEvents: 'none' }} />
                <input type={showResetPw ? 'text' : 'password'} value={resetNewPw} onChange={e => setResetNewPw(e.target.value)}
                  placeholder="••••••••••••" style={{ paddingLeft: 32, paddingRight: 36 }} required minLength={12} autoFocus />
                <button type="button" onClick={() => setShowResetPw(v => !v)} tabIndex={-1}
                  style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-400)', padding: 2, display: 'flex', alignItems: 'center' }}>
                  {showResetPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
            <div className="form-group">
              <label>Confirm Password</label>
              <div style={{ position: 'relative' }}>
                <Lock size={14} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--gray-400)', pointerEvents: 'none' }} />
                <input type={showResetPw ? 'text' : 'password'} value={resetConfirm} onChange={e => setResetConfirm(e.target.value)}
                  placeholder="••••••••••••" style={{ paddingLeft: 32, borderColor: resetConfirm && resetConfirm !== resetNewPw ? '#ef4444' : undefined }} required />
              </div>
              {resetConfirm && resetConfirm !== resetNewPw && (
                <div style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>Passwords do not match</div>
              )}
              {resetConfirm && resetConfirm === resetNewPw && resetNewPw.length >= 12 && (
                <div style={{ fontSize: 11, color: '#22c55e', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <CheckCircle2 size={11} /> Passwords match
                </div>
              )}
            </div>
            <button type="submit" disabled={loading || resetNewPw.length < 12 || resetNewPw !== resetConfirm} className="login-submit-btn">
              {loading ? <><Loader2 size={14} className="login-spin" /> Saving…</> : <><KeyRound size={14} /> Set Password &amp; Sign In</>}
            </button>
          </form>
        )}

        <p className="login-contact-note">
          Don't have an account? Contact your administrator.
        </p>
      </div>

      {/* Page footer */}
      <p className="login-page-footer">
        &copy; {new Date().getFullYear()} Odyssey Cybersecurity. All rights reserved.
      </p>

      <style>{`
        @keyframes login-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        .login-spin { animation: login-spin .9s linear infinite; }
      `}</style>
    </div>
  );
}
