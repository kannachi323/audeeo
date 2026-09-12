import { useEffect, useMemo, useRef, useState } from 'react'

const github = 'https://github.com/kannachi323'
const project = 'https://github.com/kannachi323/audeeo'

type DemoSegment = {
  start: number
  end: number
  sourceText: string
  translatedText: string
}

type DemoClip = {
  id: string
  title: string
  label: string
  description: string
  audio: string
  language: string
  proof: string
  segments: DemoSegment[]
}

type LanguageCode = 'zh' | 'es' | 'ja' | 'en'

type Language = {
  code: LanguageCode
  name: string
  nativeName: string
  locale: string
}

type StorySource = {
  audio: string
  duration: number
}

const languages: Language[] = [
  { code: 'zh', name: 'Chinese', nativeName: '中文', locale: 'zh-CN' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', locale: 'es-ES' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', locale: 'ja-JP' },
  { code: 'en', name: 'English', nativeName: 'English', locale: 'en-US' },
]

const sourceLanguages = languages.filter((language) => language.code !== 'en')

const storySources: Record<Exclude<LanguageCode, 'en'>, StorySource> = {
  zh: { audio: '/demos/three-pigs-zh.mp3', duration: 30.304 },
  es: { audio: '/demos/three-pigs-es.mp3', duration: 28.546 },
  ja: { audio: '/demos/three-pigs-ja.mp3', duration: 35.452 },
}

const storyLines: Record<LanguageCode, string[]> = {
  zh: [
    '从前，有三只小猪，它们决定各自盖一座房子。',
    '第一只小猪用稻草盖房，第二只用木头，第三只用砖头。',
    '一天，一只大灰狼来了。它吹倒了第一座房子，也吹倒了第二座房子。',
    '两只小猪马上跑进红色的房子。大灰狼想把红房子吹倒，但它非常坚固。',
    '三只小猪安全了。它们明白了，努力工作会带来安全。',
  ],
  es: [
    'Había una vez tres cerditos que decidieron construir cada uno su propia casa.',
    'El primero construyó con paja, el segundo con madera y el tercero con ladrillos.',
    'Un día llegó un gran lobo gris. Derribó de un soplido la primera casa y también la segunda.',
    'Los dos cerditos corrieron a la casa roja. El lobo intentó derribarla, pero la casa roja era muy resistente.',
    'Los tres cerditos estaban a salvo. Aprendieron que trabajar duro brinda seguridad.',
  ],
  ja: [
    '昔々、三匹の子ぶたが、それぞれ自分の家を建てることにしました。',
    '一匹目はわらで、二匹目は木で、三匹目はれんがで家を建てました。',
    'ある日、大きな灰色のオオカミがやって来ました。オオカミは一軒目と二軒目の家を吹き飛ばしました。',
    '二匹の子ぶたは赤い家に逃げ込みました。オオカミは吹き飛ばそうとしましたが、赤い家はとても頑丈でした。',
    '三匹の子ぶたは助かりました。そして、一生懸命働けば安全が得られることを学びました。',
  ],
  en: [
    'Once upon a time, three little pigs decided to each build a house.',
    'The first built with straw, the second with wood, and the third with bricks.',
    'One day, a big gray wolf came. It blew down the first house and the second house.',
    'The two pigs ran into the red house. The wolf tried to blow it down, but the red house was strong.',
    'The three little pigs were safe. They learned that hard work brings security.',
  ],
}

const baseStoryTimings = [
  { start: 1.02, end: 5.14 },
  { start: 5.76, end: 10.68 },
  { start: 11.28, end: 17.26 },
  { start: 17.88, end: 24.5 },
  { start: 25.2, end: 29.88 },
]

function getStoryTimings(duration: number) {
  const scale = duration / storySources.zh.duration
  return baseStoryTimings.map((timing) => ({
    start: timing.start * scale,
    end: timing.end * scale,
  }))
}

function getStreamedText(text: string, locale: string, progress: number) {
  if (progress <= 0) return ''
  if (progress >= 1) return text

  const wordSegments = Array.from(
    new Intl.Segmenter(locale, { granularity: 'word' }).segment(text),
  ).filter((segment) => segment.isWordLike)
  const visibleCount = Math.ceil(wordSegments.length * progress)
  const lastVisible = wordSegments[Math.max(0, visibleCount - 1)]
  return text.slice(0, lastVisible.index + lastVisible.segment.length)
}

const demos: DemoClip[] = [
  {
    id: 'single-sentence',
    title: 'Mandarin system audio',
    label: 'caption example',
    description: 'A complete sentence captured from system audio and translated into English.',
    audio: '/sample-mandarin.wav',
    language: 'zh → en',
    proof: 'prepared audio · synchronized example captions',
    segments: [
      {
        start: 0.3,
        end: 6.44,
        sourceText: '你好，今天天气很好。我们正在测试实时语音翻译系统。',
        translatedText:
          "Hello, it's a nice day. We're testing the real voice translation system.",
      },
    ],
  },
  {
    id: 'two-sentences',
    title: 'Two utterances',
    label: 'two phrases',
    description: 'Two sentences separated by silence, emitted as two correctly ordered cues.',
    audio: '/sample-two-utterances.wav',
    language: 'zh → en',
    proof: '8.0 seconds of audio · two stable WebVTT cues',
    segments: [
      {
        start: 0.02,
        end: 3.84,
        sourceText: '打开窗户，让新鲜空气进来。',
        translatedText: 'Open the window and let the fresh air in.',
      },
      {
        start: 4.48,
        end: 8.001,
        sourceText: '我们明天上午十点在火车站见面。',
        translatedText: "We'll meet at the train station tomorrow at 10:00 a.m.",
      },
    ],
  },
]

const features = [
  {
    title: 'live system audio',
    copy: 'capture supported playback on macOS and turn dialogue into live captions.',
  },
  {
    title: 'microphone captions',
    copy: 'stream microphone audio to cloud recognition and follow the words as captions.',
  },
  {
    title: 'translation in development',
    copy: 'planned text translation will turn recognized phrases into bilingual captions.',
  },
  {
    title: 'a proper overlay',
    copy: 'keep readable, always-on-top subtitles over a browser, movie, lecture, or any other application.',
  },
]

export default function App() {
  const [selectedId, setSelectedId] = useState(demos[0].id)
  const [playbackTime, setPlaybackTime] = useState(0)
  const [sourceLanguage, setSourceLanguage] = useState<Exclude<LanguageCode, 'en'>>('zh')
  const [targetLanguage, setTargetLanguage] = useState<LanguageCode>('ja')
  const [storyTime, setStoryTime] = useState(0)
  const [storyPlaying, setStoryPlaying] = useState(false)
  const storyAudioRef = useRef<HTMLAudioElement>(null)
  const animationFrameRef = useRef<number | null>(null)
  const selectedDemo = demos.find((demo) => demo.id === selectedId) ?? demos[0]
  const selectedStorySource = storySources[sourceLanguage]
  const storyTimings = useMemo(
    () => getStoryTimings(selectedStorySource.duration),
    [selectedStorySource.duration],
  )
  const activeStoryIndex = storyTimings.findIndex(
    (timing) => storyTime >= timing.start && storyTime < timing.end,
  )
  const activeStoryTiming = activeStoryIndex >= 0 ? storyTimings[activeStoryIndex] : null
  const sourceLanguageInfo = languages.find((language) => language.code === sourceLanguage)!
  const targetLanguageInfo = languages.find((language) => language.code === targetLanguage)!
  const streamProgress = activeStoryTiming
    ? Math.min(
        1,
        Math.max(
          0,
          (storyTime - activeStoryTiming.start - 0.42) /
            (activeStoryTiming.end - activeStoryTiming.start - 0.68),
        ),
      )
    : 0
  const sourceStreamProgress = activeStoryTiming
    ? Math.min(
        1,
        Math.max(
          0,
          (storyTime - activeStoryTiming.start - 0.08) /
            ((activeStoryTiming.end - activeStoryTiming.start) * 0.62),
        ),
      )
    : 0
  const streamedSource = useMemo(
    () =>
      activeStoryIndex >= 0
        ? getStreamedText(
            storyLines[sourceLanguage][activeStoryIndex],
            sourceLanguageInfo.locale,
            sourceStreamProgress,
          )
        : '',
    [activeStoryIndex, sourceLanguage, sourceLanguageInfo.locale, sourceStreamProgress],
  )
  const streamedTranslation = useMemo(
    () =>
      activeStoryIndex >= 0
        ? getStreamedText(
            storyLines[targetLanguage][activeStoryIndex],
            targetLanguageInfo.locale,
            streamProgress,
          )
        : '',
    [activeStoryIndex, streamProgress, targetLanguage, targetLanguageInfo.locale],
  )

  const syncStoryTime = () => {
    const audio = storyAudioRef.current
    if (!audio) return
    setStoryTime(audio.currentTime)
    if (!audio.paused && !audio.ended) {
      animationFrameRef.current = requestAnimationFrame(syncStoryTime)
    }
  }

  useEffect(
    () => () => {
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current)
    },
    [],
  )

  const activeSegment = useMemo(
    () =>
      selectedDemo.segments.find(
        (segment) => playbackTime >= segment.start && playbackTime < segment.end,
      ) ?? null,
    [playbackTime, selectedDemo],
  )

  const selectDemo = (id: string) => {
    setSelectedId(id)
    setPlaybackTime(0)
  }

  const selectSourceLanguage = (code: Exclude<LanguageCode, 'en'>) => {
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current)
    setStoryPlaying(false)
    setStoryTime(0)
    setSourceLanguage(code)
    if (targetLanguage === code) {
      setTargetLanguage('en')
    }
  }

  const storyStatus = (() => {
    if (storyTime >= selectedStorySource.duration - 0.1) return 'translation complete'
    if (!storyPlaying && storyTime === 0) return 'press play to begin live translation'
    if (activeStoryIndex < 0 || sourceStreamProgress === 0) return 'listening for speech…'
    if (streamProgress === 0) return 'transcribing live · partial result'
    if (streamProgress < 1) return 'translating live · partial result'
    return 'segment stable'
  })()

  return (
    <main>
      <div className="page">
        <header className="site-header">
          <a className="wordmark" href="#top" aria-label="Audeeo home">
            audeeo
          </a>
          <nav aria-label="external links">
            <a href={github} target="_blank" rel="noreferrer">
              github
            </a>
            <span aria-hidden="true">·</span>
            <a href={project} target="_blank" rel="noreferrer">
              project
            </a>
          </nav>
        </header>

        <section className="hero" id="top">
          <p className="eyebrow">open source · tauri · live captions</p>
          <h1>live speech, readable.</h1>
          <p>
            Audeeo streams microphone or supported device audio to Deepgram for live captions.
            Translation is the next step. The prepared clips below illustrate the subtitle
            experience; they do not run live recognition or translation.
          </p>
          <p className="hero-links">
            <a href="#demos">play the demos</a>
            <span aria-hidden="true">·</span>
            <a href={project} target="_blank" rel="noreferrer">
              view the source
            </a>
          </p>
        </section>

        <section className="demo" id="demos" aria-labelledby="demo-title">
          <h2 id="demo-title">preview translated captions</h2>
          <p className="section-intro">
            Pick the original narration and output language, then press play. Each translation
            arrives word by word, like a live Audeeo session.
          </p>

          <div className="language-lab">
            <div className="language-controls">
              <label>
                <span>original audio</span>
                <select
                  value={sourceLanguage}
                  onChange={(event) =>
                    selectSourceLanguage(event.target.value as Exclude<LanguageCode, 'en'>)
                  }
                >
                  {sourceLanguages.map((language) => (
                    <option key={language.code} value={language.code}>
                      {language.nativeName} · {language.name}
                    </option>
                  ))}
                </select>
              </label>

              <span className="language-arrow" aria-hidden="true">
                →
              </span>

              <label>
                <span>subtitle output</span>
                <select
                  value={targetLanguage}
                  onChange={(event) => setTargetLanguage(event.target.value as LanguageCode)}
                >
                  {languages
                    .filter((language) => language.code !== sourceLanguage)
                    .map((language) => (
                      <option key={language.code} value={language.code}>
                        {language.nativeName} · {language.name}
                      </option>
                    ))}
                </select>
              </label>
            </div>

            <div className="story-screen">
              <img
                src="/demos/three-pigs-scene.jpg"
                alt="The three little pigs beside their straw, wood, and brick houses as a wolf approaches"
              />
              <div className="live-badge">
                <span aria-hidden="true" /> live language preview
              </div>
              <div className="story-caption" aria-live="polite" aria-atomic="true">
                {activeStoryIndex >= 0 && streamedSource ? (
                  <>
                    <p className="streamed-translation" lang={targetLanguageInfo.locale}>
                      {streamedTranslation || (
                        <span className="translation-waiting">Translating…</span>
                      )}
                      {streamedTranslation && streamProgress < 1 && (
                        <span className="stream-cursor" aria-hidden="true" />
                      )}
                    </p>
                    <p className="story-source" lang={sourceLanguageInfo.locale}>
                      {streamedSource}
                      {sourceStreamProgress < 1 && (
                        <span
                          className="stream-cursor source-stream-cursor"
                          aria-hidden="true"
                        />
                      )}
                    </p>
                  </>
                ) : (
                  <p className="story-placeholder">
                    {storyPlaying ? 'Listening…' : 'Your live subtitles will appear here.'}
                  </p>
                )}
              </div>
            </div>

            <div className="story-player">
              <audio
                key={sourceLanguage}
                ref={storyAudioRef}
                controls
                preload="metadata"
                src={selectedStorySource.audio}
                onPlay={() => {
                  if (animationFrameRef.current !== null) {
                    cancelAnimationFrame(animationFrameRef.current)
                  }
                  setStoryPlaying(true)
                  animationFrameRef.current = requestAnimationFrame(syncStoryTime)
                }}
                onPause={(event) => {
                  setStoryPlaying(false)
                  setStoryTime(event.currentTarget.currentTime)
                  if (animationFrameRef.current !== null) {
                    cancelAnimationFrame(animationFrameRef.current)
                  }
                }}
                onSeeked={(event) => setStoryTime(event.currentTarget.currentTime)}
                onEnded={() => {
                  setStoryPlaying(false)
                  setStoryTime(selectedStorySource.duration)
                }}
              />
              <p className={`live-status ${storyPlaying ? 'is-live' : ''}`} role="status">
                <span aria-hidden="true" /> {storyStatus}
              </p>
            </div>

            <div className="featured-proof">
              <span>one story · three original languages</span>
              <span>four subtitle languages</span>
              <span>word-by-word partial results</span>
            </div>
          </div>

          <p className="language-note">
            The multilingual player illustrates subtitle behavior using prepared narration
            and translations. Additional prepared caption examples appear below.
          </p>

          <h3 className="clip-heading">caption examples</h3>

          <div className="demo-picker" role="group" aria-label="Choose a demo clip">
            {demos.map((demo, index) => {
              const selected = demo.id === selectedDemo.id
              return (
                <button
                  key={demo.id}
                  type="button"
                  className={selected ? 'selected' : undefined}
                  aria-pressed={selected}
                  onClick={() => selectDemo(demo.id)}
                >
                  <span className="demo-number">0{index + 1}</span>
                  <span>
                    <strong>{demo.title}</strong>
                    <small>{demo.label}</small>
                  </span>
                </button>
              )
            })}
          </div>

          <div className="experience">
            <div className="sample-shell">
              <div>
                <span className="clip-label">{selectedDemo.label}</span>
                <h3>{selectedDemo.title}</h3>
                <p>{selectedDemo.description}</p>
              </div>
              <audio
                key={selectedDemo.id}
                controls
                preload="metadata"
                src={selectedDemo.audio}
                onTimeUpdate={(event) => setPlaybackTime(event.currentTarget.currentTime)}
                onEnded={() => {
                  const finalCue = selectedDemo.segments.at(-1)
                  if (finalCue) setPlaybackTime(finalCue.end - 0.001)
                }}
              />
              <span className="proof">{selectedDemo.proof}</span>
            </div>

            <div className="caption-shell" aria-live="polite">
              <div className="caption-heading">
                <span>translated subtitle</span>
                <span>{selectedDemo.language}</span>
              </div>
              <div className="caption-copy">
                {activeSegment ? (
                  <>
                    <p className="translation">{activeSegment.translatedText}</p>
                    <p className="source-text">{activeSegment.sourceText}</p>
                  </>
                ) : (
                  <p className="caption-placeholder">Press play to follow the translation.</p>
                )}
              </div>
              <p className="demo-status">prepared captions · no live model running in this demo</p>
            </div>
          </div>

          <p className="demo-note">
            These demo players use bundled audio and prepared subtitles without uploading audio.
            The Audeeo application uses cloud speech recognition.
          </p>
        </section>

        <section aria-labelledby="features-title">
          <h2 id="features-title">what it does</h2>
          <ul className="feature-list">
            {features.map((feature) => (
              <li key={feature.title}>
                <h3>{feature.title}</h3>
                <p>{feature.copy}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="how" aria-labelledby="how-title">
          <h2 id="how-title">how it works</h2>
          <p>
            microphone or supported device audio → 16 kHz PCM → Deepgram → live captions
          </p>
          <p>
            Planned: stable transcript phrases → Qwen text translation → translated captions.
            Performance will be measured on the current application before release.
          </p>
        </section>

        <footer>
          <p>built by matthew chen. audeeo is open source.</p>
          <p>
            <a href={github} target="_blank" rel="noreferrer">
              github
            </a>
            <span aria-hidden="true"> · </span>
            <a href={project} target="_blank" rel="noreferrer">
              audeeo repository
            </a>
          </p>
        </footer>
      </div>
    </main>
  )
}
