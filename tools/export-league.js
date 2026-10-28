#!/usr/bin/env node
// Writes the whole league to editable spreadsheets in public/local/ (git-ignored):
//   teams.csv, roster.csv, depth.csv
// Any edits already in those files are loaded first and kept; the old files are backed up.
//   npm run export-league
import fs from 'fs';
import path from 'path';
import { defaultTeams } from '../src/data/teams.js';
import { generateLeagueRosters } from '../src/data/generator.js';
import { parseCSV, importRosterRows, importTeamsRows, importDepthRows, exportRosterCSV, exportTeamsCSV, exportDepthCSV } from '../src/data/csv.js';

const dir = path.resolve('public/local');
fs.mkdirSync(path.join(dir, 'logos'), { recursive: true });
const read = (f) => (fs.existsSync(path.join(dir, f)) ? parseCSV(fs.readFileSync(path.join(dir, f), 'utf8')) : null);

const teams = generateLeagueRosters(defaultTeams(), 2027);
let playAs = null;
const t = read('teams.csv');
if (t) playAs = importTeamsRows(teams, t).playAs;
const r = read('roster.csv');
if (r) {
  const s = importRosterRows(teams, r);
  if (playAs === null && s.teams.length === 1) playAs = teams.find((x) => x.abbr === s.teams[0]).id;
}
const d = read('depth.csv');
if (d) importDepthRows(teams, d);

const existing = ['teams.csv', 'roster.csv', 'depth.csv'].filter((f) => fs.existsSync(path.join(dir, f)));
if (existing.length) {
  const bk = path.join(dir, 'backup-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
  fs.mkdirSync(bk);
  for (const f of existing) fs.copyFileSync(path.join(dir, f), path.join(bk, f));
  console.log(`Backed up your current files to ${path.relative(process.cwd(), bk)}/`);
}
fs.writeFileSync(path.join(dir, 'teams.csv'), exportTeamsCSV(teams, playAs));
fs.writeFileSync(path.join(dir, 'roster.csv'), exportRosterCSV(teams));
fs.writeFileSync(path.join(dir, 'depth.csv'), exportDepthCSV(teams));
console.log(`Wrote public/local/teams.csv (32 teams), roster.csv (${teams.reduce((a, x) => a + x.roster.length, 0)} players), depth.csv`);
console.log(playAs !== null ? `You play as: ${teams[playAs].city} ${teams[playAs].name} (play_as column in teams.csv)` : 'Set play_as = Y on a row in teams.csv to choose your team.');
