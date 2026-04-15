import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Logo from '../components/Logo';

const styles = {
  page: {
    minHeight: '100vh',
    background: '#060810',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: "'DM Mono', monospace",
    position: 'relative',
    overflow: 'hidden',
  },
  grid: {
    position: 'absolute', inset: 0,
    backgroundImage: `
      linear-gradient(rgba(0,229,255,0.04) 1px, transparent 1px),
      linear-gradient(90deg, rgba(0,229,255,0.04) 1px, transparent 1px)
    `,
    backgroundSize: '40px 40px',
    animation: 'gridMove 20s linear infinite',
  },
  glow: {
    position: 'absolute',
    width: '600px', height: '600px',
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(0,229,255,0.06) 0%, transparent 70%)',
    top: '50%', left: '50%',
    transform: 'translate(-50%, -50%)',
    pointerEvents: 'none',
  },
  card: {
    position: 'relative',
    width: '420px',
    background: 'rgba(10,14,22,0.95)',
    border: '1px solid rgba(0,229,255,0.15)',
    borderRadius: '16px',
    padding: '44px 40px',
    backdropFilter: 'blur(20px)',
    boxShadow: '0 0 80px rgba(0,229,255,0.05), 0 40px 80px rgba(0,0,0,0.6)',
    animation: 'cardIn 0.5s cubic-bezier(0.34,1.56,0.64,1)',
  },
  logoRow: {
    display: 'flex', alignItems: 'center', gap: '12px',
    marginBottom: '32px',
  },
  logoBox: {
    width: '38px', height: '38px',
    background: 'linear-gradient(135deg, #00e5ff, #00b8d4)',
    borderRadius: '10px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '18px', fontWeight: '700', color: '#060810',
  },
  logoText: {
    fontFamily: "'Clash Display', sans-serif",
    fontSize: '20px', fontWeight: '700',
    color: '#fff', letterSpacing: '-0.02em',
  },
  logoSub: { color: '#00e5ff' },
  tagline: {
    fontSize: '11px', color: '#3a5060',
    letterSpacing: '0.15em', textTransform: 'uppercase',
    marginLeft: 'auto',
  },
  heading: {
    fontFamily: "'Clash Display', sans-serif",
    fontSize: '26px', fontWeight: '600',
    color: '#fff', marginBottom: '6px',
    letterSpacing: '-0.02em',
  },
  sub: {
    fontSize: '12px', color: '#4a6070',
    marginBottom: '28px', lineHeight: '1.6',
  },
  // OAuth buttons
  oauthRow: { display: 'flex', gap: '10px', marginBottom: '24px' },
  oauthBtn: {
    flex: 1,
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
    padding: '11px 16px',
    borderRadius: '8px',
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.04)',
    color: '#c0d0e0',
    fontSize: '12px', fontFamily: "'DM Mono', monospace",
    cursor: 'pointer',
    transition: 'all 0.2s',
    letterSpacing: '0.05em',
  },
  divider: {
    display: 'flex', alignItems: 'center', gap: '12px',
    margin: '0 0 24px',
    fontSize: '10px', color: '#2a3a4a',
    letterSpacing: '0.1em',
  },
  dividerLine: { flex: 1, height: '1px', background: 'rgba(255,255,255,0.06)' },
  // Form
  formGroup: { marginBottom: '16px' },
  label: {
    display: 'block', fontSize: '10px',
    color: '#4a6070', letterSpacing: '0.12em',
    textTransform: 'uppercase', marginBottom: '6px',
  },
  input: {
    width: '100%', padding: '11px 14px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '8px',
    color: '#c0d8e8', fontSize: '13px',
    fontFamily: "'DM Mono', monospace",
    outline: 'none', transition: 'border-color 0.2s',
    boxSizing: 'border-box',
  },
  submitBtn: {
    width: '100%', padding: '13px',
    background: 'linear-gradient(135deg, #00e5ff, #00b8d4)',
    border: 'none', borderRadius: '8px',
    color: '#060810', fontSize: '13px',
    fontFamily: "'DM Mono', monospace",
    fontWeight: '500', cursor: 'pointer',
    transition: 'opacity 0.2s, transform 0.15s',
    letterSpacing: '0.05em', marginTop: '8px',
  },
  toggle: {
    textAlign: 'center', marginTop: '20px',
    fontSize: '12px', color: '#3a5060',
  },
  toggleLink: {
    color: '#00e5ff', cursor: 'pointer',
    textDecoration: 'none', marginLeft: '4px',
  },
  error: {
    background: 'rgba(255,69,105,0.08)',
    border: '1px solid rgba(255,69,105,0.3)',
    borderRadius: '6px', padding: '10px 14px',
    color: '#ff6d8a', fontSize: '11px',
    marginBottom: '16px', lineHeight: '1.5',
  },
  demoBadge: {
    background: 'rgba(0,229,255,0.08)',
    border: '1px solid rgba(0,229,255,0.2)',
    borderRadius: '6px', padding: '8px 12px',
    color: '#00b8d4', fontSize: '10px',
    letterSpacing: '0.08em', textAlign: 'center',
    marginBottom: '20px', lineHeight: '1.6',
  },
};

const css = `
  @keyframes gridMove { to { background-position: 40px 40px; } }
  @keyframes cardIn { from { opacity:0; transform: translateY(24px) scale(0.97); } to { opacity:1; transform: none; } }
  .oauth-btn:hover { border-color: rgba(255,255,255,0.2) !important; background: rgba(255,255,255,0.08) !important; color: #fff !important; }
  .nr-input:focus { border-color: rgba(0,229,255,0.4) !important; background: rgba(0,229,255,0.03) !important; }
  .submit-btn:hover { opacity: 0.88; transform: translateY(-1px); }
  .submit-btn:active { transform: translateY(0); }
`;

const GoogleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
);

const FacebookIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="#1877F2">
    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
  </svg>
);

export default function LoginPage() {
  const { loginLocal, registerLocal, loginWithGoogle, loginWithFacebook, error, setError, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState('login'); // login | register
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [demoMode, setDemoMode] = useState(false);

  useEffect(() => { if (isAuthenticated) navigate('/dashboard'); }, [isAuthenticated, navigate]);
  useEffect(() => { setError(null); }, [mode, setError]);

  const handleSubmit = async e => {
    e.preventDefault();
    setLoading(true);
    const res = mode === 'login'
      ? await loginLocal(form.email, form.password)
      : await registerLocal(form.name, form.email, form.password);
    setLoading(false);
    if (res.ok) { if (res.demo) setDemoMode(true); else navigate('/dashboard'); }
  };

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <>
      <style>{css}</style>
      <div style={styles.page}>
        <div style={styles.grid} />
        <div style={styles.glow} />
        <div style={styles.card}>
          {/* Logo */}
          <div style={styles.logoRow}>
            <Logo size={38}/>
            <span style={styles.logoText}>Ether<span style={styles.logoSub}>.</span></span>
            <span style={styles.tagline}>Auth</span>
          </div>

          <h1 style={styles.heading}>{mode === 'login' ? 'Welcome back' : 'Create account'}</h1>
          <p style={styles.sub}>
            {mode === 'login'
              ? 'Sign in to access your Ether dashboard'
              : 'Connect your automation workspace'}
          </p>

          {demoMode && (
            <div style={styles.demoBadge}>
              DEMO MODE — Node-RED not detected at localhost:1880<br/>
              Running with mock authentication
            </div>
          )}

          {error && <div style={styles.error}>{error}</div>}

          {/* OAuth */}
          <div style={styles.oauthRow}>
            <button className="oauth-btn" style={styles.oauthBtn} onClick={loginWithGoogle}>
              <GoogleIcon /> Google
            </button>
            <button className="oauth-btn" style={styles.oauthBtn} onClick={loginWithFacebook}>
              <FacebookIcon /> Facebook
            </button>
          </div>

          <div style={styles.divider}>
            <div style={styles.dividerLine} />
            OR CONTINUE WITH EMAIL
            <div style={styles.dividerLine} />
          </div>

          {/* Local form */}
          <form onSubmit={handleSubmit}>
            {mode === 'register' && (
              <div style={styles.formGroup}>
                <label style={styles.label}>Full Name</label>
                <input className="nr-input" style={styles.input}
                  type="text" placeholder="Alice Smith"
                  value={form.name} onChange={set('name')} required />
              </div>
            )}
            <div style={styles.formGroup}>
              <label style={styles.label}>Email Address</label>
              <input className="nr-input" style={styles.input}
                type="email" placeholder="alice@example.com"
                value={form.email} onChange={set('email')} required />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Password</label>
              <input className="nr-input" style={styles.input}
                type="password" placeholder="••••••••"
                value={form.password} onChange={set('password')} required />
            </div>
            <button className="submit-btn" style={styles.submitBtn} type="submit" disabled={loading}>
              {loading ? 'AUTHENTICATING...' : mode === 'login' ? 'SIGN IN →' : 'CREATE ACCOUNT →'}
            </button>
          </form>

          <div style={styles.toggle}>
            {mode === 'login' ? "Don't have an account?" : 'Already have an account?'}
            <span style={styles.toggleLink} onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
              {mode === 'login' ? ' Register' : ' Sign in'}
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
