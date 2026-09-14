import { ArrowRight } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { FaApple } from 'react-icons/fa'
import { Link } from 'react-router'
import { ProductDemo } from '../components/ProductDemo'

const heroWords = ['conversations.', 'meetings.', 'lectures.', 'movies.', 'every moment.'] as const

function clamp(value: number) {
  return Math.min(1, Math.max(0, value))
}

function useScrollProgress() {
  const ref = useRef<HTMLDivElement>(null)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const element = ref.current
    if (!element || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let frame = 0
    let previousTime = 0
    let current = 0
    let target = 0
    const measure = () => {
      const rect = element.getBoundingClientRect()
      target = clamp(-rect.top / Math.max(1, rect.height - innerHeight))
    }
    const animate = (now: number) => {
      measure()
      const elapsed = previousTime ? Math.min(64, now - previousTime) : 1000 / 60
      previousTime = now
      current += (target - current) * (1 - Math.exp(-elapsed / 65))
      if (Math.abs(target - current) < .00005) current = target
      setProgress(current)
      frame = current === target ? 0 : requestAnimationFrame(animate)
      if (!frame) previousTime = 0
    }
    const update = () => { if (!frame) frame = requestAnimationFrame(animate) }
    measure()
    current = target
    setProgress(current)
    addEventListener('scroll', update, { passive: true })
    addEventListener('resize', update)
    return () => {
      removeEventListener('scroll', update)
      removeEventListener('resize', update)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  return { ref, progress }
}

function useTypingRotation(words: readonly string[]) {
  const [index, setIndex] = useState(0)
  const [typed, setTyped] = useState(words[0] ?? '')
  const [phase, setPhase] = useState<'typing' | 'holding' | 'deleting'>('holding')

  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || words.length < 2) return
    const word = words[index] ?? ''
    let delay = 110
    let advance = () => setTyped(word.slice(0, typed.length + 1))
    if (phase === 'holding') { delay = 2200; advance = () => setPhase('deleting') }
    else if (phase === 'deleting' && typed.length > 0) { delay = 70; advance = () => setTyped(word.slice(0, typed.length - 1)) }
    else if (phase === 'deleting') { delay = 320; advance = () => { setIndex((value) => (value + 1) % words.length); setPhase('typing') } }
    else if (typed.length >= word.length) advance = () => setPhase('holding')
    const timer = setTimeout(advance, delay)
    return () => clearTimeout(timer)
  }, [index, phase, typed, words])

  return { typed, complete: phase === 'holding' }
}

export function Home() {
  const { ref, progress: rawProgress } = useScrollProgress()
  const progress = rawProgress * .8
  const { typed, complete } = useTypingRotation(heroWords)
  const longest = heroWords.reduce((result, word) => word.length > result.length ? word : result, '')
  const zoom = clamp((progress - .02) / .34)
  const expansion = clamp((progress - .42) / .38)
  const copyOpacity = progress >= .42 ? 0 : 1 - clamp((progress - .32) / .1)
  const productOpacity = clamp((progress - .42) / .14)
  const buttonsOpacity = 1 - clamp(progress / .02)
  const style = {
    '--hero-copy-opacity': copyOpacity,
    '--hero-copy-scale': 1 + 3.8 * zoom,
    '--hero-copy-shift': `${-6 * zoom}svh`,
    '--hero-product-opacity': productOpacity,
    '--hero-product-scale': .94 + .06 * expansion,
    '--hero-product-shift': `${4 * (1 - expansion)}svh`,
    '--hero-shot-radius': `${16 - 4 * expansion}px`,
  } as CSSProperties

  return (
    <div className="home-page">
      <section className="hero-section" aria-labelledby="hero-title">
        <div ref={ref} className="hero-scroll-track">
          <div className="hero-scroll-stage">
            <div className="hero-scroll-layout site-container" style={style}>
              <div className="hero-scroll-copy" aria-hidden={copyOpacity < .05} inert={copyOpacity < .05 ? true : undefined}>
                <div className="hero-scroll-zoom-group">
                  <h1 id="hero-title" aria-label="Live captions for conversations, meetings, lectures, movies, and every moment." className="hero-animate">
                    <span aria-hidden="true">
                      <span className="hero-lead">Live captions for</span>
                      <span className="hero-word-grid">
                        <span className="invisible-word">{longest}</span>
                        <span>{typed}<i className={`typing-cursor ${complete ? 'blinking' : ''}`} /></span>
                      </span>
                    </span>
                  </h1>
                </div>
                <div className="hero-scroll-buttons" style={{ opacity: buttonsOpacity }} aria-hidden={buttonsOpacity === 0} inert={buttonsOpacity < 1 ? true : undefined}>
                  <div className="hero-actions hero-animate delay-two">
                    <Link className="button primary desktop-download" to="/download"><FaApple aria-hidden="true" /> Download for macOS</Link>
                    <Link className="button primary mobile-download" to="/download">Download Audeeo</Link>
                    <Link className="button outline" to="/register">Create account</Link>
                  </div>
                </div>
              </div>
              <div className="hero-scroll-product" aria-hidden={productOpacity < .05} inert={productOpacity < .05 ? true : undefined}>
                <div className="hero-scroll-shot"><ProductDemo /></div>
                <div className="hero-product-cta"><Link className="button primary" to="/download">Get Audeeo <ArrowRight aria-hidden="true" /></Link></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="feature-section site-container" id="features" aria-labelledby="features-title">
        <header className="chapter-intro">
          <h2 id="features-title">Features</h2>
        </header>
        <div className="feature-grid">
          <article><span>01</span><h3>Live captions</h3><p>Read microphone or supported Mac audio as it happens.</p></article>
          <article><span>02</span><h3>Translation</h3><p>Move between spoken and translated language in the same view.</p></article>
          <article><span>03</span><h3>Focused overlay</h3><p>Keep readable subtitles above the call, lecture, or video.</p></article>
        </div>
      </section>

    </div>
  )
}
