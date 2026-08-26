import React, { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

export default function AuthGate({ children, session }) {
  const [mode, setMode] = useState('signin') // signin | signup | forgot | recovery
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setMode('recovery')
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  if (session && mode !== 'recovery') return children

  const resetMessages = () => { setError(''); setInfo('') }

  const handleSignIn = async (e) => {
    e.preventDefault()
    resetMessages()
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) setError(error.message)
  }

  const handleSignUp = async (e) => {
    e.preventDefault()
    resetMessages()
    if (password !== confirmPassword) { setError("Passwords don't match."); return }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return }
    setLoading(true)
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName || email } },
    })
    setLoading(false)
    if (error) setError(error.message)
    else setInfo("Account created — you're signed in.")
  }

  const handleForgot = async (e) => {
    e.preventDefault()
    resetMessages()
    setLoading(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    })
    setLoading(false)
    if (error) setError(error.message)
    else setInfo('Check your email for a password reset link.')
  }

  const handleSetNewPassword = async (e) => {
    e.preventDefault()
    resetMessages()
    if (newPassword.length < 6) { setError('Password must be at least 6 characters.'); return }
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setLoading(false)
    if (error) setError(error.message)
    else { setInfo('Password updated. You can now use it to sign in.'); setMode('signin') }
  }

  const inputStyle = { width: '100%', padding: '9px 12px', border: '1px solid #CBD5E0', borderRadius: 8, fontSize: 13 }
  const btnStyle = { background: '#0F7FC4', color: '#fff', border: 'none', borderRadius: 8, padding: '10px', fontSize: 13, cursor: 'pointer', width: '100%' }
  const linkStyle = { fontSize: 12, color: '#0F7FC4', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F5F7FA', padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 32, width: '100%', maxWidth: 380, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <h1 style={{ fontSize: 16, fontWeight: 600, color: '#1B2A3C', margin: '0 0 4px' }}>HRBP Deliverables Tracker</h1>

        {mode === 'recovery' && (
          <>
            <p style={{ fontSize: 13, color: '#6B7280', margin: '0 0 20px' }}>Choose a new password for your account.</p>
            <form onSubmit={handleSetNewPassword} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input type="password" required placeholder="New password" style={inputStyle} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              <button type="submit" disabled={loading} style={btnStyle}>{loading ? 'Saving…' : 'Set new password'}</button>
            </form>
          </>
        )}

        {mode === 'signin' && (
          <>
            <p style={{ fontSize: 13, color: '#6B7280', margin: '0 0 20px' }}>Sign in with your work email.</p>
            <form onSubmit={handleSignIn} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input type="email" required placeholder="you@creditdirect.ng" style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} />
              <input type="password" required placeholder="Password" style={inputStyle} value={password} onChange={(e) => setPassword(e.target.value)} />
              <button type="submit" disabled={loading} style={btnStyle}>{loading ? 'Signing in…' : 'Sign in'}</button>
            </form>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14 }}>
              <button style={linkStyle} onClick={() => { resetMessages(); setMode('signup') }}>Create an account</button>
              <button style={linkStyle} onClick={() => { resetMessages(); setMode('forgot') }}>Forgot password?</button>
            </div>
          </>
        )}

        {mode === 'signup' && (
          <>
            <p style={{ fontSize: 13, color: '#6B7280', margin: '0 0 20px' }}>First time here — create your account.</p>
            <form onSubmit={handleSignUp} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input type="text" required placeholder="Full name" style={inputStyle} value={fullName} onChange={(e) => setFullName(e.target.value)} />
              <input type="email" required placeholder="you@creditdirect.ng" style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} />
              <input type="password" required placeholder="Password (min 6 characters)" style={inputStyle} value={password} onChange={(e) => setPassword(e.target.value)} />
              <input type="password" required placeholder="Confirm password" style={inputStyle} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
              <button type="submit" disabled={loading} style={btnStyle}>{loading ? 'Creating…' : 'Create account'}</button>
            </form>
            <div style={{ marginTop: 14 }}>
              <button style={linkStyle} onClick={() => { resetMessages(); setMode('signin') }}>Already have an account? Sign in</button>
            </div>
          </>
        )}

        {mode === 'forgot' && (
          <>
            <p style={{ fontSize: 13, color: '#6B7280', margin: '0 0 20px' }}>Enter your email and we'll send a reset link.</p>
            <form onSubmit={handleForgot} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input type="email" required placeholder="you@creditdirect.ng" style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} />
              <button type="submit" disabled={loading} style={btnStyle}>{loading ? 'Sending…' : 'Send reset link'}</button>
            </form>
            <div style={{ marginTop: 14 }}>
              <button style={linkStyle} onClick={() => { resetMessages(); setMode('signin') }}>Back to sign in</button>
            </div>
          </>
        )}

        {error && <p style={{ fontSize: 12, color: '#993C1D', marginTop: 14 }}>{error}</p>}
        {info && <p style={{ fontSize: 12, color: '#085041', marginTop: 14 }}>{info}</p>}
      </div>
    </div>
  )
}
