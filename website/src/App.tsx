import { useEffect, useRef, useState } from 'react'
import { Link, Route, Routes, useLocation } from 'react-router'
import { useAuth } from './AuthContext'
import { AccountDialog } from './components/AccountDialog'
import { Footer } from './components/Footer'
import { Navbar } from './components/Navbar'
import { AuthPage } from './pages/Auth'
import { Download } from './pages/Download'
import { Home } from './pages/Home'
import { Pricing } from './pages/Pricing'

const titles: Record<string, string> = {
  '/': 'Audeeo — Live captions, made clear',
  '/download': 'Download Audeeo',
  '/pricing': 'Pricing — Audeeo',
  '/signin': 'Sign in — Audeeo',
  '/register': 'Create an account — Audeeo',
}

function NotFound() {
  return <section className="not-found"><p className="page-label">404</p><h1>Page not found.</h1><p>That page doesn’t exist. Check the link or head back home.</p><Link className="button primary" to="/">Back to Audeeo</Link></section>
}

export default function App() {
  const location = useLocation()
  const { session, signOut } = useAuth()
  const [accountOpen, setAccountOpen] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const stored = localStorage.getItem('audeeo-website-theme')
    if (stored === 'dark' || stored === 'light') return stored
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  const mainRef = useRef<HTMLElement>(null)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('audeeo-website-theme', theme)
  }, [theme])

  useEffect(() => {
    document.title = titles[location.pathname] ?? 'Audeeo'
    scrollTo(0, 0)
    const frame = requestAnimationFrame(() => {
      const heading = mainRef.current?.querySelector<HTMLElement>('h1')
      if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }) }
    })
    return () => cancelAnimationFrame(frame)
  }, [location.pathname])

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <Navbar theme={theme} onToggleTheme={() => setTheme((value) => value === 'dark' ? 'light' : 'dark')} onOpenAccount={() => setAccountOpen(true)} />
      <div className="nav-spacer" aria-hidden="true" />
      <main id="main-content" ref={mainRef}>
        <div key={location.pathname} className="page-transition">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/download" element={<Download />} />
            <Route path="/pricing" element={<Pricing />} />
            <Route path="/signin" element={<AuthPage mode="signin" />} />
            <Route path="/register" element={<AuthPage mode="register" />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </div>
      </main>
      <Footer />
      {accountOpen && session && <AccountDialog session={session} onClose={() => setAccountOpen(false)} onSignOut={signOut} />}
    </div>
  )
}
