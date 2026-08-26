export default function App() {
  const [session, setSession] = useState(undefined)
  const [theme, setTheme] = useState('light')
  const [recoveryMode, setRecoveryMode] = useState(false)

  useEffect(() => {
    const root = document.documentElement
    const vars = theme === 'dark' ? DARK : LIGHT
    Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v))
  }, [theme])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  if (session === undefined) return <div style={{ minHeight: '100vh', background: 'var(--bg0)' }} />

  return (
    <AuthGate session={session} recoveryMode={recoveryMode} onRecoveryDone={() => setRecoveryMode(false)}>
      <Dashboard session={session} theme={theme} setTheme={setTheme} />
    </AuthGate>
  )
}
