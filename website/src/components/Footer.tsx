import { FaGithub } from 'react-icons/fa6'
import { Link } from 'react-router'
import { Brand } from './Brand'

const projectUrl = 'https://github.com/kannachi323/audeeo'

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="site-container footer-grid">
        <div className="footer-brand-column">
          <Link className="brand" to="/"><Brand /></Link>
          <a className="footer-social" href={projectUrl} target="_blank" rel="noreferrer"><FaGithub aria-hidden="true" /> GitHub</a>
        </div>
        <nav aria-label="Explore footer links"><h2>Explore</h2><a href="/#features">Features</a><Link to="/pricing">Pricing</Link><Link to="/download">Download</Link><Link to="/register">Create account</Link></nav>
      </div>
      <div className="site-container footer-bottom"><span>© 2026 Matthew Chen</span><a href={`${projectUrl}/blob/main/LICENSE`} target="_blank" rel="noreferrer">License</a></div>
    </footer>
  )
}
