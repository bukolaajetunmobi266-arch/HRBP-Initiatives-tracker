import React, { useState } from 'react'
import { supabase } from './supabaseClient'

export default function AuthGate({ children, session }) {
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  if (session) return children

  const sendMagicLink = async (e) => {
    e.preventDefault()
    setError('')
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        data: { full_name: fullName || email },
        emailRedirectTo: window.location.origin,
      },
    })
    if (error) setError(error.message)
    else setSent(true)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="bg-white rounded-xl shadow-sm p-8 w-full max-w-sm">
        <h1 className="text-lg font-semibold text-brand-navy mb-1">HRBP Deliverables Tracker</h1>
        <p className="text-sm text-gray-500 mb-6">Sign in with your work email to continue.</p>

        {sent ? (
          <p className="text-sm text-gray-600">
            Check <span className="font-medium">{email}</span> for a sign-in link.
          </p>
        ) : (
          <form onSubmit={sendMagicLink} className="flex flex-col gap-3">
            <input
              type="text"
              placeholder="Full name (first time only)"
              className="input"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
            <input
              type="email"
              required
              placeholder="you@creditdirect.ng"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button type="submit" className="bg-brand-blue text-white text-sm rounded-lg py-2 hover:opacity-90">
              Send sign-in link
            </button>
            {error && <p className="text-xs text-red-600">{error}</p>}
          </form>
        )}
      </div>
    </div>
  )
}
