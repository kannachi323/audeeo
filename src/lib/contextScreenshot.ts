import {contextScreenshot, MAX_SCREENSHOT_BYTES} from '../../shared/contextScreenshot';

// Keep full-screen text readable while bounding the image sent to the model.
export async function prepareContextScreenshot(dataURL: string): Promise<string> {
  const image = new Image();
  image.src = dataURL;
  await image.decode().catch(()=>{throw new Error('Could not read the screenshot. Try again.');});
  const scale = Math.min(1, 2560 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if(!context) throw new Error('Could not prepare the screenshot. Try again.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  for(const quality of [.9,.75,.6]) {
    const encoded = canvas.toDataURL('image/jpeg', quality);
    if(encoded.length <= Math.ceil(MAX_SCREENSHOT_BYTES / 3) * 4 + 32) return contextScreenshot(encoded);
  }
  throw new Error('Screenshot is too large. Try a smaller display resolution.');
}
