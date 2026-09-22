import { useEffect, useState } from 'react'
import { FaApple } from 'react-icons/fa'
import { FcGoogle } from 'react-icons/fc'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { useAuth } from '../AuthContext'

function safeReturnPath(value: string | null | undefined) {
  return value?.startsWith('/') && !value.startsWith('//') ? value : '/'
}

export function AuthPage({ mode }: { mode: 'signin' | 'register' }) {
  const { session, ready, configured, signIn } = useAuth()
  const [busy, setBusy] = useState<'apple' | 'google' | null>(null)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const returnTo = safeReturnPath(params.get('returnTo') ?? (location.state as { from?: string } | null)?.from)

  useEffect(() => {
    if (ready && session) navigate(returnTo, { replace: true })
  }, [navigate, ready, returnTo, session])

  const begin = async (provider: 'apple' | 'google') => {
    setBusy(provider)
    setError('')
    try { await signIn(provider, returnTo) }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Sign-in failed. Please try again.')
      setBusy(null)
    }
  }

  const registering = mode === 'register'
  return (
    <section className="auth-page" aria-labelledby="auth-title">
      <div className="auth-shell">
        <header>
          <h1 id="auth-title">{registering ? 'Create an account' : 'Sign in'}</h1>
          <p>For the optional Audeeo service.</p>
        </header>
        <div className="auth-card">
          <div className="provider-list">
            <button type="button" onClick={() => void begin('google')} disabled={Boolean(busy)}>
              <FcGoogle aria-hidden="true" /><span>{busy === 'google' ? 'Connecting…' : `${registering ? 'Sign up' : 'Continue'} with Google`}</span>
            </button>
            <button type="button" onClick={() => void begin('apple')} disabled={Boolean(busy)}>
              <FaApple aria-hidden="true" /><span>{busy === 'apple' ? 'Connecting…' : `${registering ? 'Sign up' : 'Continue'} with Apple`}</span>
            </button>
          </div>
          {!configured && <p className="auth-message muted" role="status">Sign-in is currently unavailable. Please try again later.</p>}
          {error && <p className="auth-message error" role="alert">{error}</p>}
          <footer>
            {registering ? <Link to="/signin">Already have an account? Sign in</Link> : <Link to="/register">Don’t have an account? Create one</Link>}
          </footer>
        </div>
        <p className="auth-terms">By continuing, you agree to the <Link to="/terms">terms</Link>. <Link to="/privacy">Privacy policy</Link>.</p>
      </div>
    </section>
  )
}
