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
