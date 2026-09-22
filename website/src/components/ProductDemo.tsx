import { Image, Film } from 'lucide-react'

declare const __AUDEEO_DEMO_VIDEO__: string

// Replace these slots with the owner's app media. Recordings use native controls.
export function ProductDemo({ kind = 'video' }: { kind?: 'video' | 'screenshot' }) {
  const recording = kind === 'video' ? __AUDEEO_DEMO_VIDEO__ : ''
  const Icon = kind === 'video' ? Film : Image
  return <figure className={`product-preview ${kind}-preview`}>
    {recording
      ? <video controls playsInline preload="metadata" src={recording} aria-label="Audeeo demonstration" />
      : <div className="media-placeholder" role="img" aria-label={`App ${kind} placeholder`}>
          <Icon aria-hidden="true" />
          <span>App {kind} placeholder</span>
        </div>}
  </figure>
}
