import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const AuthContext = createContext(null);

const NR_BASE = process.env.REACT_APP_NR_URL || 'http://localhost:1880';

export function AuthProvider({ children }) {
  const [user, setUser]           = useState(null);
  const [token, setToken]         = useState(localStorage.getItem('nf_token'));
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [nrStatus, setNrStatus]   = useState('disconnected'); // disconnected | connecting | connected | error
  const [nrWs, setNrWs]           = useState(null);

  // Restore session on mount
  useEffect(() => {
    const stored = localStorage.getItem('nf_user');
    const storedToken = localStorage.getItem('nf_token');
    if (stored && storedToken) {
      try {
        setUser(JSON.parse(stored));
        setToken(storedToken);
        axios.defaults.headers.common['Authorization'] = `Bearer ${storedToken}`;
      } catch (e) { logout(); }
    }
    setLoading(false);
  }, []);

  // ─── Local auth ──────────────────────────────────────────────
  const loginLocal = useCallback(async (email, password) => {
    setError(null);
    try {
      // POST to Node-RED /auth/local endpoint
      const res = await axios.post(`${NR_BASE}/auth/local`, { email, password });
      const { token: t, user: u } = res.data;
      persistAuth(t, u);
      return { ok: true };
    } catch (e) {
      // Demo fallback when Node-RED not running
      if (!e.response || e.response.status === 0) {
        const demoUser = {
          id: 'demo-' + Date.now(),
          name: email.split('@')[0],
          email,
          provider: 'local',
          avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(email)}&background=00e5ff&color=060810&bold=true`,
          role: 'admin',
          loginAt: new Date().toISOString(),
        };
        persistAuth('demo-token-' + Date.now(), demoUser);
        return { ok: true, demo: true };
      }
      const msg = e.response?.data?.message || 'Login failed';
      setError(msg);
      return { ok: false, error: msg };
    }
  }, []);

  const registerLocal = useCallback(async (name, email, password) => {
    setError(null);
    try {
      const res = await axios.post(`${NR_BASE}/auth/register`, { name, email, password });
      const { token: t, user: u } = res.data;
      persistAuth(t, u);
      return { ok: true };
    } catch (e) {
      if (!e.response || e.response.status === 0) {
        // Demo mode
        const demoUser = {
          id: 'demo-' + Date.now(),
          name,
          email,
          provider: 'local',
          avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=ff6b35&color=fff&bold=true`,
          role: 'user',
          loginAt: new Date().toISOString(),
        };
        persistAuth('demo-token-' + Date.now(), demoUser);
        return { ok: true, demo: true };
      }
      const msg = e.response?.data?.message || 'Registration failed';
      setError(msg);
      return { ok: false, error: msg };
    }
  }, []);

  // ─── OAuth providers ─────────────────────────────────────────
  const loginWithGoogle = useCallback(() => {
    // Redirect to Node-RED Google OAuth endpoint
    window.location.href = `${NR_BASE}/auth/google`;
  }, []);

  const loginWithFacebook = useCallback(() => {
    window.location.href = `${NR_BASE}/auth/facebook`;
  }, []);

  // Handle OAuth callback token in URL hash/query
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthToken = params.get('token');
    const oauthUser  = params.get('user');
    if (oauthToken && oauthUser) {
      try {
        const u = JSON.parse(decodeURIComponent(oauthUser));
        persistAuth(oauthToken, u);
        window.history.replaceState({}, '', '/');
      } catch (e) { console.error('OAuth parse error', e); }
    }
  }, []);

  // ─── Node-RED WebSocket ──────────────────────────────────────
  const connectToNodeRed = useCallback(() => {
    if (nrWs) nrWs.close();
    setNrStatus('connecting');
    try {
      const ws = new WebSocket(`${NR_BASE.replace('http', 'ws')}/comms`);
      ws.onopen = () => setNrStatus('connected');
      ws.onerror = () => setNrStatus('error');
      ws.onclose = () => setNrStatus('disconnected');
      setNrWs(ws);
      return ws;
    } catch (e) {
      setNrStatus('error');
      return null;
    }
  }, [nrWs]);

  // ─── Helpers ─────────────────────────────────────────────────
  function persistAuth(t, u) {
    setToken(t);
    setUser(u);
    localStorage.setItem('nf_token', t);
    localStorage.setItem('nf_user', JSON.stringify(u));
    axios.defaults.headers.common['Authorization'] = `Bearer ${t}`;
  }

  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
    setError(null);
    localStorage.removeItem('nf_token');
    localStorage.removeItem('nf_user');
    delete axios.defaults.headers.common['Authorization'];
    if (nrWs) nrWs.close();
    setNrStatus('disconnected');
  }, [nrWs]);

  return (
    <AuthContext.Provider value={{
      user, token, loading, error, setError,
      nrStatus, nrWs, connectToNodeRed,
      loginLocal, registerLocal,
      loginWithGoogle, loginWithFacebook,
      logout,
      isAuthenticated: !!user,
      NR_BASE,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};
