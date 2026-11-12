import { describe, it, expect } from 'vitest';
import { defaultTeams } from '../src/data/teams.js';
import { generateLeagueRosters } from '../src/data/generator.js';
import { parseCSV } from '../src/data/csv.js';
import { exportLeagueBook, importLeagueBook, splitLeagueBook } from '../src/data/leagueBook.js';
import { importUniforms, exportUniforms, importStadiums, exportStadiums } from '../src/data/extraCSV.js';
import { FONTS, fontOf, cssFont, parsePatch, patchCell, resolvePatches, resolveCaptainPatch, ENDZONE_STYLES, guideLines } from '../src/data/design.js';
import { assignCaptains, captainsOf, hasCaptain } from '../src/data/captains.js';
import { exportRosterCSV } from '../src/data/csv.js';

const league = (seed = 5) => generateLeagueRosters(defaultTeams(), seed);

describe('design vocabulary', () => {
  it('fonts resolve from ids and display names; unknown ones do not', () => {
    expect(fontOf('Bebas Neue').id).toBe('bebas_neue');
    expect(fontOf('bebas-neue').id).toBe('bebas_neue');
    expect(fontOf('GRADUATE').family).toBe('Graduate');
    expect(fontOf('comic sans')).toBe(null);
    expect(cssFont('oswald', 40)).toContain('"Oswald"');
    expect(cssFont('nope', 40)).toContain('"Saira Condensed"'); // falls back
    expect(new Set(FONTS.map((f) => f.id)).size).toBe(FONTS.length);
  });
  it('patch cells parse and print back', () => {
    expect(parsePatch('')).toBe(null);
    expect(parsePatch('none')).toEqual({ none: true });
    expect(parsePatch('https://example.com/a.png')).toEqual({ image: 'https://example.com/a.png' });
    expect(parsePatch('captain_patch.PNG')).toEqual({ image: 'captain_patch.PNG' });
    expect(patchCell(parsePatch('anniversary.png'))).toBe('anniversary.png');
    expect(parsePatch('team_logo')).toEqual({ logo: 'team_logo' });
    expect(parsePatch('League Logo')).toEqual({ logo: 'league_logo' });
    const p = parsePatch('circle:c:#ffd100:#111111:#111111');
    expect(p).toEqual({ shape: 'circle', text: 'C', bg: '#ffd100', fg: '#111111', border: '#111111' });
    expect(patchCell(p)).toBe('circle:C:#ffd100:#111111:#111111');
    expect(parsePatch('star:_:#ffd100')).toEqual({ shape: 'star', text: '', bg: '#ffd100' });
    expect(parsePatch('blob:A').error).toMatch(/unknown patch/);
    expect(parsePatch('circle:A:red').error).toMatch(/bad patch background/);
    expect(parsePatch('shield:ABCDE').text).toBe('ABC'); // 3 letters at most
  });
  it('the guide names every font, shape and end zone style', () => {
    const g = guideLines().join('\n');
    for (const f of FONTS) expect(g).toContain(f.id);
    for (const k of Object.keys(ENDZONE_STYLES)) expect(g).toContain(k);
    expect(g).toContain('circle');
    expect(g).toContain('AI model');
  });
});

describe('uniform design columns', () => {
  it('fonts and patches import, round-trip, and bad values are reported with the allowed list', () => {
    const a = league();
    const csv = 'team,kind,jersey,pants,number,number_outline,helmet,number_font,name_font,patch_font,left_chest,right_chest,left_sleeve,right_sleeve\n'
      + `${a[1].abbr},home,#111111,#ffffff,#ffffff,#ff0000,#111111,Graduate,bebas_neue,oswald,circle:C:#ffd100:#111111:#111111,league_logo,shield:25,wrong:X\n`
      + `${a[1].abbr},away,#ffffff,#ffffff,#111111,#ff0000,#111111,papyrus,,,,,,\n`;
    const r = importUniforms(a, parseCSV(csv));
    expect(r.count).toBe(2);
    expect(r.skipped.some((s) => /unknown patch "wrong:X"/.test(s))).toBe(true);
    expect(r.skipped.some((s) => /unknown number_font "papyrus"/.test(s) && /oswald/.test(s))).toBe(true);
    const u = a[1].uniforms.home;
    expect(u).toMatchObject({ numberFont: 'graduate', nameFont: 'bebas_neue', patchFont: 'oswald' });
    expect(u.patches.left_chest).toMatchObject({ shape: 'circle', text: 'C' });
    expect(u.patches.right_chest).toEqual({ logo: 'league_logo' });
    expect(u.patches.left_sleeve).toMatchObject({ shape: 'shield', text: '25' });
    expect(u.patches.right_sleeve).toBeUndefined();
    expect(a[1].uniforms.away.numberFont).toBeUndefined();
    // Export keeps them; a plain league keeps the plain columns.
    const out = exportUniforms(a);
    expect(out.split('\n')[0]).toContain('number_font');
    expect(out).toContain('graduate');
    expect(out).toContain('circle:C:#ffd100:#111111:#111111');
    expect(exportUniforms(league()).split('\n')[0]).toBe('team,kind,jersey,pants,number,number_outline,helmet');
    expect(exportUniforms(league(), { designColumns: true }).split('\n')[0]).toContain('right_sleeve');
    const b = league(9);
    importUniforms(b, parseCSV(out));
    expect(b[1].uniforms.home.patches.left_chest).toMatchObject({ shape: 'circle', text: 'C' });
  });
  it('column names are forgiving about case and spaces', () => {
    const a = league();
    importUniforms(a, parseCSV(`Team,Kind,Jersey,Number Font,Left Chest\n${a[2].abbr},home,#222222,Anton,star:_:#ffd100\n`));
    expect(a[2].uniforms.home).toMatchObject({ jersey: '#222222', numberFont: 'anton' });
    expect(a[2].uniforms.home.patches.left_chest.shape).toBe('star');
  });
});

describe('end zone design columns', () => {
  it('import, validate and export', () => {
    const a = league();
    const csv = 'team,name,city,capacity,roof,surface,kind,year,turf,endzone,mid_logo,seats,endzone_color,endzone_color2,endzone_text_color,endzone_outline_color,endzone_font,endzone_text_left,endzone_text_right,endzone_logo_left,endzone_logo_right,yard_font\n'
      + `${a[0].abbr},Test Field,Boston,60000,open,grass,home,,dark,Chevron,on,#222222,#112233,#445566,#ffffff,#000000,Bebas Neue,IRONSIDES,_,team,none,oswald\n`
      + `${a[1].abbr},Bad Field,X,1,open,grass,home,,plaid,swirl,,,nothex,,,,helvetica,,,sideways,,arial\n`;
    const r = importStadiums(a, parseCSV(csv));
    expect(r.count).toBe(2);
    const s = a[0].stadium;
    expect(s).toMatchObject({ turf: 'dark', endzone: 'chevron', ezColor: '#112233', ezColor2: '#445566', ezText: '#ffffff', ezOutline: '#000000', ezFont: 'bebas_neue', ezLeft: 'IRONSIDES', ezRight: '', ezLogoLeft: 'team', ezLogoRight: 'none', yardFont: 'oswald' });
    expect(r.skipped.length).toBeGreaterThanOrEqual(6);
    expect(a[1].stadium.endzone).toBeUndefined();
    const out = exportStadiums(a);
    expect(out.split('\n')[0]).toContain('endzone_font');
    const b = league(11);
    importStadiums(b, parseCSV(out));
    expect(b[0].stadium).toMatchObject({ endzone: 'chevron', ezFont: 'bebas_neue', ezLeft: 'IRONSIDES', ezRight: '', yardFont: 'oswald' });
  });
});

describe('league book guide', () => {
  it('a book starts with a README that is ignored on import and shows the design columns', () => {
    const a = league();
    const text = exportLeagueBook(a);
    expect(text.startsWith('[README]')).toBe(true);
    const secs = splitLeagueBook(text);
    expect(secs.README).toContain('ALLOWED FONTS');
    expect(secs.UNIFORMS.split('\n')[0]).toContain('left_chest');
    expect(secs.STADIUMS.split('\n')[0]).toContain('endzone_font');
    const b = league(12);
    const r = importLeagueBook(b, text);
    expect(r.problems.filter((p) => !/depth/i.test(p))).toEqual([]);
  });
  it('# comment lines are skipped inside sections and in standalone files', () => {
    const a = league();
    const csv = `# a comment\nteam,kind,jersey\n# another\n${a[0].abbr},home,#123456\n`;
    importUniforms(a, parseCSV(csv));
    expect(a[0].uniforms.home.jersey).toBe('#123456');
    const book = `[UNIFORMS]\n# comment inside\nteam,kind,jersey\n${a[1].abbr},home,#654321\n`;
    importLeagueBook(a, book);
    expect(a[1].uniforms.home.jersey).toBe('#654321');
  });
});

describe('patches: images, the collar default, captains', () => {
  it('the league logo sits under the V-neck on every team unless removed; none removes a patch', () => {
    expect(resolvePatches({}).collar).toEqual({ logo: 'league_logo' });
    expect(resolvePatches({ collar: { none: true } }).collar).toBeUndefined();
    expect(resolvePatches({ collar: { image: 'x.png' }, left_chest: { logo: 'team_logo' } })).toMatchObject({ collar: { image: 'x.png' }, left_chest: { logo: 'team_logo' } });
  });
  it('image links import for every slot and the captain badge, and export back', () => {
    const a = league();
    const csv = 'team,kind,jersey,captain_patch,left_chest,right_chest,left_sleeve,right_sleeve,collar\n'
      + `${a[3].abbr},home,#222222,cap.png,https://example.com/a.png,b.jpg,"data:image/svg+xml;utf8,<svg/>",c.svg,none\n`;
    const r = importUniforms(a, parseCSV(csv));
    expect(r.skipped).toEqual([]);
    const u = a[3].uniforms.home;
    expect(u.captainPatch).toEqual({ image: 'cap.png' });
    expect(u.patches.left_chest).toEqual({ image: 'https://example.com/a.png' });
    expect(u.patches.collar).toEqual({ none: true });
    expect(resolveCaptainPatch(u)).toEqual({ image: 'cap.png' });
    expect(exportUniforms(a)).toContain('cap.png');
    // The default captain badge uses the uniform colors.
    expect(resolveCaptainPatch({ jersey: '#111111', number: '#ffffff', outline: '#ff0000' })).toMatchObject({ text: 'C', bg: '#111111', fg: '#ffffff', border: '#ff0000' });
    expect(resolveCaptainPatch({ captainPatch: { none: true } })).toBe(null);
  });
  it('only a few players per team are captains by default, and the roster column sets them', () => {
    const a = league();
    for (const t of a) { const n = captainsOf(t).length; expect(n).toBeGreaterThanOrEqual(2); expect(n).toBeLessThanOrEqual(3); expect(captainsOf(t).some((p) => p.pos === 'QB')).toBe(true); }
    const csv = exportRosterCSV(a);
    expect(csv.split('\n')[0]).toContain(',captain');
    expect(csv).toContain(',Y');
    // A file naming its own captains replaces the defaults.
    const b = league(21);
    const rows = parseCSV(csv).filter((r) => r.team === b[0].abbr);
    for (const r of rows) r.captain = '';
    rows[5].captain = 'Y'; rows[9].captain = 'yes';
    const head = Object.keys(rows[0]);
    const text = head.join(',') + '\n' + rows.map((r) => head.map((h) => r[h]).join(',')).join('\n');
    importLeagueBook(b, `[ROSTER]\n${text}\n`);
    expect(captainsOf(b[0]).length).toBe(2);
    // A team whose file lists no captain gets the default three.
    const c = league(22);
    const rows2 = parseCSV(csv).filter((r) => r.team === c[1].abbr);
    for (const r of rows2) r.captain = '';
    const text2 = head.join(',') + '\n' + rows2.map((r) => head.map((h) => r[h]).join(',')).join('\n');
    importLeagueBook(c, `[ROSTER]\n${text2}\n`);
    expect(hasCaptain(c[1])).toBe(true);
  });
  it('the guide explains captains and image patches', () => {
    const g = guideLines().join('\n');
    expect(g).toMatch(/captain = Y/);
    expect(g).toMatch(/IMAGE LINK/);
    expect(g).toMatch(/under the V-neck/);
  });
});
