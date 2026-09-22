import { Link } from 'react-router'
import { FaGithub } from 'react-icons/fa'
import { Brand } from './Brand'

export function Footer() {
  return <footer className="site-footer">
    <div className="site-container footer-inner">
      <div className="footer-grid">
        <div className="footer-brand-column">
          <Link className="footer-brand" to="/" aria-label="Audeeo home"><Brand /></Link>
          <a className="footer-social" href="https://github.com/kannachi323/audeeo" target="_blank" rel="noreferrer"><FaGithub aria-hidden="true" />GitHub</a>
        </div>
        <div className="footer-columns">
          <nav aria-label="Explore footer links"><h2>Explore</h2><Link to="/pricing">Pricing</Link><Link to="/download">Download</Link></nav>
          <nav aria-label="Resources footer links"><h2>Resources</h2><Link to="/support">Support</Link></nav>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} Audeeo</span>
        <nav aria-label="Legal"><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link><a href="https://github.com/kannachi323/audeeo/blob/main/LICENSE" target="_blank" rel="noreferrer">MIT license</a></nav>
      </div>
    </div>
  </footer>
}
