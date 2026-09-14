import { ArrowUpRight } from 'lucide-react'
import { FaApple } from 'react-icons/fa'

const releasesUrl = 'https://github.com/kannachi323/audeeo/releases'

export function Download() {
  return (
    <div className="public-page">
      <header className="public-page-header centered compact"><h1>Download</h1></header>
      <section className="release-section" aria-labelledby="release-title">
        <div className="release-heading"><h2 id="release-title">macOS</h2><span>In development</span></div>
        <article className="download-card">
          <div className="platform-title"><FaApple aria-hidden="true" /><div><h3>Audeeo</h3><p>Apple silicon · macOS 14.2+</p></div></div>
          <a className="download-link" href={releasesUrl} target="_blank" rel="noreferrer">Releases <ArrowUpRight aria-hidden="true" /></a>
        </article>
      </section>
    </div>
  )
}
