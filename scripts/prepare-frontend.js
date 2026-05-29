import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const copyQueue = [
  {
    src: 'node_modules/@xterm/xterm/css/xterm.css',
    dest: 'resources/css/xterm.css'
  },
  {
    src: 'node_modules/@xterm/xterm/lib/xterm.js',
    dest: 'resources/js/xterm.js'
  },
  {
    src: 'node_modules/@xterm/addon-fit/lib/addon-fit.js',
    dest: 'resources/js/xterm-addon-fit.js'
  }
];

console.log('Copying frontend dependencies to resources...');

let hasError = false;

copyQueue.forEach(({ src, dest }) => {
  const srcPath = path.join(rootDir, src);
  const destPath = path.join(rootDir, dest);

  const destDir = path.dirname(destPath);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  if (fs.existsSync(srcPath)) {
    const stats = fs.statSync(srcPath);
    if (stats.size === 0) {
      console.error(`Source file is empty: ${srcPath}`);
      hasError = true;
      return;
    }
    fs.copyFileSync(srcPath, destPath);
    console.log(`Copied: ${src} -> ${dest}`);
  } else {
    console.error(`Source file not found: ${srcPath}`);
    hasError = true;
  }
});

if (hasError) {
  console.error('Frontend preparation failed!');
  process.exit(1);
}

console.log('Frontend preparation complete!');
