// The editor's palettes and image preparation. Images travel base64 in a workflow parameter,
// which Linux caps at 128 KB per value: each one stays below 88 KB (the framework accepts 90 KB).

/** Curated accents; any other colour is the custom one. */
export const PALETTES: { id: string; accent: string }[] = [
  { id: 'fyso', accent: '#6e1fff' },
  { id: 'ocean', accent: '#0b6bcb' },
  { id: 'teal', accent: '#0e9384' },
  { id: 'forest', accent: '#2f855a' },
  { id: 'gold', accent: '#c99700' },
  { id: 'sunset', accent: '#e8590c' },
  { id: 'ruby', accent: '#c81e4f' },
  { id: 'graphite', accent: '#3f3f46' },
];

const MAX_BYTES = 88 * 1024;
const bytes = (base64: string) => Math.floor((base64.length * 3) / 4);

export function base64Utf8(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

async function load(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Any image the browser can open, as a square PNG (base64, no prefix), small enough to save. */
export async function iconPng(file: File): Promise<string> {
  const img = await load(file);
  for (const max of [256, 192, 128, 96]) {
    const size = Math.min(max, Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const scale = size / Math.max(img.naturalWidth, img.naturalHeight);
    const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
    canvas.getContext('2d')!.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
    const data = canvas.toDataURL('image/png').split(',')[1];
    if (bytes(data) <= MAX_BYTES) return data;
  }
  throw new Error('icon too large');
}

/** A photo for the login background, as a JPEG (base64, no prefix), small enough to save. */
export async function backgroundJpeg(file: File): Promise<string> {
  const img = await load(file);
  for (const max of [1600, 1280, 1024]) {
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#0e0e12'; // transparent images get the login's dark base
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.7, 0.58, 0.46]) {
      const data = canvas.toDataURL('image/jpeg', quality).split(',')[1];
      if (bytes(data) <= MAX_BYTES) return data;
    }
  }
  throw new Error('background too large');
}
