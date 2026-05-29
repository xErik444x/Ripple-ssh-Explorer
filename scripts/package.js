import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist', 'neutralino');
const extDir = path.join(rootDir, 'extensions', 'ssh-connector');

const version = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8')).version;

const platforms = [
  { name: 'win-x64', exe: 'neutralino-win_x64.exe' },
  { name: 'linux-x64', exe: 'neutralino-linux_x64' },
  { name: 'linux-arm64', exe: 'neutralino-linux_arm64' },
  { name: 'linux-armhf', exe: 'neutralino-linux_armhf' },
  { name: 'mac-x64', exe: 'neutralino-mac_x64' },
  { name: 'mac-arm64', exe: 'neutralino-mac_arm64' },
  { name: 'mac-universal', exe: 'neutralino-mac_universal' }
];

console.log(`Packaging Ripple SSH v${version}...\n`);

// Step 1: Build extension node_modules with npm (flat, no symlinks)
console.log('Installing extension dependencies with npm (flat node_modules)...');
const extBuildDir = path.join(distDir, '_ext_build');

if (fs.existsSync(extBuildDir)) fs.rmSync(extBuildDir, { recursive: true });
fs.mkdirSync(extBuildDir, { recursive: true });

// Copy extension source
fs.copyFileSync(path.join(extDir, 'main.js'), path.join(extBuildDir, 'main.js'));
fs.copyFileSync(path.join(extDir, 'package.json'), path.join(extBuildDir, 'package.json'));

// Install with npm (creates flat node_modules, no symlinks)
try {
  execSync('npm install --production --no-audit --no-fund', {
    cwd: extBuildDir,
    stdio: 'pipe'
  });
  console.log('  ✓ Extension dependencies installed\n');
} catch (e) {
  console.error('  ✗ npm install failed:', e.message);
  process.exit(1);
}

// Step 2: Package each platform
for (const platform of platforms) {
  const platformDir = path.join(distDir, `ripple-ssh-${platform.name}`);
  const zipName = `ripple-ssh-${platform.name}-v${version}.zip`;

  if (fs.existsSync(platformDir)) fs.rmSync(platformDir, { recursive: true });
  fs.mkdirSync(platformDir, { recursive: true });

  // Copy exe
  fs.copyFileSync(path.join(distDir, platform.exe), path.join(platformDir, platform.exe));
  fs.chmodSync(path.join(platformDir, platform.exe), 0o755);

  // Copy extension (with real node_modules)
  const extDest = path.join(platformDir, 'extensions', 'ssh-connector');
  fs.mkdirSync(extDest, { recursive: true });
  fs.cpSync(extBuildDir, extDest, { recursive: true });

  // Copy neutralino config
  const configSrc = path.join(distDir, 'neutralino.config.json');
  if (fs.existsSync(configSrc)) {
    fs.copyFileSync(configSrc, path.join(platformDir, 'neutralino.config.json'));
  }

  // Create zip
  try {
    execSync(`powershell Compress-Archive -Path "${platformDir}" -DestinationPath "${path.join(distDir, zipName)}" -Force`);
    const zipSize = (fs.statSync(path.join(distDir, zipName)).size / 1024 / 1024).toFixed(1);
    console.log(`  ✓ ${zipName} (${zipSize} MB)`);
  } catch (e) {
    console.error(`  ✗ Failed to zip ${platform.name}: ${e.message}`);
  }

  fs.rmSync(platformDir, { recursive: true });
}

// Cleanup build dir
fs.rmSync(extBuildDir, { recursive: true });

console.log(`\nDone! Zips are in dist/neutralino/`);
