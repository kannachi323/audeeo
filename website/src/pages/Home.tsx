import { Link } from 'react-router'
import { ProductDemo } from '../components/ProductDemo'

export function Home() {
  return <section className="product-page" aria-labelledby="product-name">
    <header className="product-intro">
      <h1 id="product-name">Live captions and translation.</h1>
      <p>Open source. Bring your own API key or subscribe.</p>
      <div className="product-links">
        <Link className="button primary" to="/download">Get Audeeo</Link>
        <Link className="text-link" to="/pricing">Pricing</Link>
      </div>
    </header>
    <ProductDemo />
  </section>
}
