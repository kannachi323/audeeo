// Screenshots travel only with the explicit context-fill request, never in settings.
export const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;
export const MAX_SCREENSHOT_REQUEST_BYTES = Math.ceil(MAX_SCREENSHOT_BYTES / 3) * 4 + 4096;
export const SCREENSHOT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export function contextScreenshot(value: unknown): string {
  const invalid = () => Object.assign(new Error('Choose a valid PNG, JPEG, or WebP screenshot.'), {status:400});
  if(typeof value !== 'string') throw invalid();
  if(value.length > MAX_SCREENSHOT_REQUEST_BYTES) throw Object.assign(new Error('Screenshot is too large. Use an image under 4 MB.'), {status:413});
  const comma=value.indexOf(',');
  const type=value.slice(0,comma);
  if(!SCREENSHOT_TYPES.some(mime=>type===`data:${mime};base64`)) throw invalid();
  const encoded=value.slice(comma+1);
  if(!encoded || encoded.length%4!==0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw invalid();
  let bytes:string;
  try { bytes=atob(encoded); } catch { throw invalid(); }
  if(bytes.length > MAX_SCREENSHOT_BYTES) throw Object.assign(new Error('Screenshot is too large. Use an image under 4 MB.'), {status:413});
  const matches=type.includes('image/png') ? bytes.startsWith('\x89PNG\r\n\x1a\n')
    : type.includes('image/jpeg') ? bytes.startsWith('\xff\xd8\xff')
    : bytes.startsWith('RIFF') && bytes.slice(8,12)==='WEBP';
  if(!matches) throw invalid();
  return value;
}
