import fs from 'fs';
import path from 'path';

import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const copyQueue = [
  {
    src: 'node_modules/xterm/css/xterm.css',
    dest: 'resources/css/xterm.css'
  },
  {
    src: 'node_modules/xterm/lib/xterm.js',
    dest: 'resources/js/xterm.js'
  },
  {
    src: 'node_modules/xterm-addon-fit/lib/xterm-addon-fit.js',
    dest: 'resources/js/xterm-addon-fit.js'
  }
];

console.log('Copying frontend dependencies to resources...');

copyQueue.forEach(({ src, dest }) => {
  // Normalize paths for safety
  const srcPath = path.join(rootDir, src);
  const destPath = path.join(rootDir, dest);

  const destDir = path.dirname(destPath);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, destPath);
    console.log(`Copied: ${src} -> ${dest}`);
  } else {
    console.error(`Source file not found: ${srcPath}`);
    process.exit(1);
  }
});

console.log('Frontend preparation complete!');
