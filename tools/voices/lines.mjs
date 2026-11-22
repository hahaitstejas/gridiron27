// Writes voice/lines.json (every commentary clip: id, text, voice, energy) for tools/voices/make_voices.py.
// Run by `npm run voices` before the recorder; the list itself lives in src/game/voiceLines.js.
import { writeFileSync, mkdirSync } from 'node:fs';
import { voiceClips } from '../../src/game/voiceLines.js';

mkdirSync('voice', { recursive: true });
const clips = voiceClips();
writeFileSync('voice/lines.json', JSON.stringify({ clips }, null, 1));
console.log(`voice/lines.json: ${clips.length} clips (${clips.filter((c) => c.voice === 'color').length} analyst)`);
