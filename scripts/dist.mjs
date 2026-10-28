import { cp, mkdir, rm } from 'node:fs/promises';

const out = new URL('../.tauri-dist/', import.meta.url);
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

for (const name of ['index.html', 'src', 'assets']) {
  await cp(new URL(`../${name}`, import.meta.url), new URL(name, out), { recursive: true });
}

console.log('copied index.html, src, assets to .tauri-dist');
