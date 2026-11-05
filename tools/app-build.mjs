// Builds the Mac app (`npm run app:build`). A personal icon at public/local/app-icon.png (git-ignored, like the rest of
// your league files) is used instead of build/icon.png, so it's in your app but never in the public repo.
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const mine = 'public/local/app-icon.png';
const icon = existsSync(mine) ? mine : 'build/icon.png';
console.log(`App icon: ${icon}`);
execSync('npx vite build --mode app', { stdio: 'inherit' });
execSync(`npx electron-builder --mac --arm64 -c.mac.icon="${icon}"`, { stdio: 'inherit' });
