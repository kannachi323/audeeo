import { AudioLines, Languages, Mic, Play, Settings2 } from 'lucide-react'

export function ProductDemo() {
  return (
    <figure className="app-window" aria-label="Audeeo caption window preview">
      <div className="window-bar">
        <div className="traffic-lights" aria-hidden="true"><i /><i /><i /></div>
        <span>Audeeo</span>
        <span className="listening-state"><i /> Ready</span>
      </div>
      <div className="preview-scene">
        <img src="/demos/three-pigs-scene.jpg" alt="Illustration of the three little pigs and their houses" />
        <div className="preview-scrim" />
        <div className="caption-panel">
          <p className="translated-copy">The three little pigs were safe inside the strong brick house.</p>
          <p className="source-copy">三只小猪在坚固的砖房里安全了。</p>
        </div>
      </div>
      <div className="product-toolbar" aria-hidden="true">
        <div className="toolbar-source"><AudioLines /><span>System audio</span></div>
        <div className="toolbar-language"><Mic /><span>中文</span><Languages /><span>English</span></div>
        <span className="toolbar-spacer" />
        <Settings2 />
        <span className="toolbar-play"><Play /></span>
      </div>
    </figure>
  )
}
