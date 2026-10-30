// After `vite build --mode offline`: name the single-file build so it's easy to find and double-click.
import { renameSync, statSync } from 'node:fs';
renameSync('dist-offline/index.html', 'dist-offline/Gridiron27.html');
console.log(`dist-offline/Gridiron27.html  ${(statSync('dist-offline/Gridiron27.html').size / 1e6).toFixed(1)} MB — open it in Chrome or Safari, no server or internet needed.`);
