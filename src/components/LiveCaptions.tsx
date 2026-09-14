import { useLayoutEffect, useRef, useState } from 'react';

/** Layout-only pagination: retain a measured suffix, independently of provider items. */
export function captionSuffix(text: string, fits: (text: string) => boolean) {
  const chars = Array.from(text.replace(/\s+/gu, ' '));
  let low = 0, high = chars.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (fits(chars.slice(mid).join(''))) high = mid; else low = mid + 1;
  }
  const space = chars.indexOf(' ', low);
  if (low > 0 && space >= low && space - low < 18) low = space + 1;
  return chars.slice(low).join('').trim();
}

function CaptionLine({text, lines, size, lang, kind}: {text: string; lines: number; size: number; lang: string; kind: 'source' | 'translation'}) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [visible, setVisible] = useState('');
  useLayoutEffect(() => {
    const element = ref.current!;
    const update = () => {
      const probe = element.cloneNode(false) as HTMLParagraphElement;
      Object.assign(probe.style, {position:'fixed', left:'0', top:'0', contain:'strict', visibility:'hidden', width:`${element.clientWidth}px`, pointerEvents:'none'});
      element.parentElement!.appendChild(probe);
      const suffix = captionSuffix(text, candidate => {
        probe.textContent = candidate;
        return probe.scrollHeight <= probe.clientHeight + 1;
      });
      probe.remove();
      setVisible(suffix);
    };
    update();
    let disposed = false;
    void document.fonts?.ready.then(() => { if (!disposed) update(); });
    let previousWidth = element.clientWidth;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === previousWidth) return;
      previousWidth = element.clientWidth;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { if (!disposed) update(); });
    }); observer.observe(element);
    return () => { disposed = true; cancelAnimationFrame(frame); observer.disconnect(); };
  }, [text, lines, size]);
  return <p ref={ref} lang={lang === "auto" ? undefined : lang} dir="auto" className={`caption-line ${kind === 'source' ? 'source-caption' : 'translated-caption'}`} style={{fontSize:size, lineHeight:'1.35', height:`${lines*1.35}em`}}>{visible}</p>;
}
export function LiveCaptions({source, translation, sourceLanguage, targetLanguage, size}: {source: string; translation: string; sourceLanguage: string; targetLanguage: string; size: number}) {
  const both = !!source && !!translation;
  return <section className="captions" aria-label="Live captions" aria-live="polite">
    {source && <CaptionLine kind="source" text={source} lines={both?1:2} size={both?size*.8:size} lang={sourceLanguage}/>}
    {translation && <CaptionLine kind="translation" text={translation} lines={both?1:2} size={size} lang={targetLanguage}/>}
  </section>;
}
