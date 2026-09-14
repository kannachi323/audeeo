import { useEffect, useState } from 'react'
import { Menu, Moon, Sun, X } from 'lucide-react'
import { FaGithub } from 'react-icons/fa6'
import { Link, NavLink, useLocation } from 'react-router'
import { useAuth } from '../AuthContext'
import { Brand } from './Brand'

const projectUrl = 'https://github.com/kannachi323/audeeo'
export function Navbar({ theme, onToggleTheme, onOpenAccount }: {
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  onOpenAccount: () => void
}) {
  const { session, ready } = useAuth()
  const location = useLocation()
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    const update = () => setScrolled(scrollY > 60)
    update()
    addEventListener('scroll', update, { passive: true })
    return () => removeEventListener('scroll', update)
  }, [])

  useEffect(() => setMobileOpen(false), [location.pathname])

  return (
    <nav className="floating-nav" aria-label="Primary navigation">
      {ready && (
        <div className={`nav-width navbar-transition ${scrolled ? 'is-compact' : ''}`}>
          <div className={`nav-shell ${mobileOpen ? 'menu-open' : ''}`}>
            <div className="nav-row">
              <Link className="nav-brand" to="/" aria-label="Audeeo home" onClick={() => setMobileOpen(false)}><Brand /></Link>
              <div className="desktop-nav">
                <NavLink to="/download">Download</NavLink>
                <NavLink to="/pricing">Pricing</NavLink>
                <div className="nav-actions">
                  <a className="nav-social-link" href={projectUrl} target="_blank" rel="noreferrer" aria-label="Audeeo on GitHub"><FaGithub aria-hidden="true" /></a>
                  {session ? (
                    <button className="account-button" type="button" onClick={onOpenAccount} aria-label="Open account">{(session.user.email?.[0] ?? '?').toUpperCase()}</button>
                  ) : (
                    <Link className="sign-in-button" to="/signin" state={{ from: location.pathname }}>Sign in</Link>
                  )}
                  <button className="nav-icon-button" type="button" onClick={onToggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
                    {theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
                  </button>
                </div>
              </div>
              <div className="mobile-nav-actions">
                <button className="nav-icon-button" type="button" onClick={onToggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
                  {theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
                </button>
                <button className="nav-icon-button" type="button" aria-expanded={mobileOpen} aria-controls="mobile-navigation" aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'} onClick={() => setMobileOpen((value) => !value)}>
                  {mobileOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
                </button>
              </div>
            </div>
            <div className="mobile-menu" id="mobile-navigation">
              <div className="mobile-menu-inner">
                <NavLink to="/download">Download</NavLink>
                <NavLink to="/pricing">Pricing</NavLink>
                {session ? <button type="button" onClick={() => { setMobileOpen(false); onOpenAccount() }}>Account</button> : <Link className="mobile-sign-in" to="/signin" state={{ from: location.pathname }}>Sign in</Link>}
              </div>
            </div>
          </div>
        </div>
      )}
    </nav>
  )
}
