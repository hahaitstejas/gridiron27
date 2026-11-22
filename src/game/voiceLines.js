// Recorded commentary: every clip the booth can say (pure data). tools/voices/lines.mjs writes it out for the recorder
// (tools/voices/make_voices.py, Chatterbox on the user's Mac); the game stitches clips into calls (game/booth.js,
// audio/boothAudio.js). A clip is { id, text, voice: 'pbp' | 'color', energy: 0 calm | 1 up | 2 big }.
// Names are recorded on their own (every last name the generator uses, every default team name), plus yard lines and
// gains, so a call is built like: [name] [throw] … [catch_by] [name] … [the_30] [the_20] … [td_2].
// Our own booth: no real announcer's lines or catchphrases.
import { LAST_NAMES } from '../data/names.js';
import { defaultTeams } from '../data/teams.js';

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
  'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
export const numberWords = (n) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : ''));
export const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

// [id, text, energy] groups; numbered variants are picked at random by the booth (id_1, id_2, ...).
const PBP = {
  throw: [['fires it', 1], ['throws it', 1], ['lets it go', 1], ['puts it in the air', 1]],
  throw_deep: [['goes deep!', 2], ['airs it out!', 2], ['lets it fly!', 2], ['takes a shot downfield!', 2]],
  throw_quick: [['a quick throw', 1], ['gets it out fast', 1]],
  handoff: [['hands it off to', 1], ['gives it to', 1], ['the handoff to', 1]],
  scramble: [['he takes off!', 2], ["he's gonna run it!", 2], ['tucks it and runs!', 2]],
  catch_by: [['caught by', 1], ['complete to', 1], ['pulled in by', 1]],
  catch_big: [['what a catch by', 2], ['great grab by', 2], ['hauled in by', 2]],
  catch_plain: [['and it is complete!', 1], ['and he makes the catch!', 1]],
  room: [["he's got room!", 2], ["he's loose!", 2], ['nobody around him!', 2], ["he's in the clear!", 2]],
  gonna_score: [["he's gonna score!", 2], ["nobody's catching him!", 2], ['he could go all the way!', 2]],
  cut: [['cuts back!', 2], ['makes a man miss!', 2], ['spins away!', 2], ['breaks a tackle!', 2]],
  stopped: [['stopped right there', 1], ['met at the line', 1], ['nowhere to go', 1]],
  brought_down: [['brought down by', 1], ['tackled by', 1], ['and he is taken down by', 1]],
  td: [['touchdown!', 2], ["he's in! touchdown!", 2], ['into the end zone, touchdown!', 2], ['touchdown! what a play!', 2], ['he scores!', 2], ['six points!', 2]],
  int: [['intercepted!', 2], ['picked off!', 2], ["it's picked!", 2], ['and it is intercepted!', 2]],
  fumble: [['the ball is out!', 2], ['fumble!', 2], ['he coughs it up!', 2], ['loose ball!', 2]],
  recovered_by: [['recovered by', 2], ['falls on it,', 2]],
  defense_ball: [['and the defense has it!', 2], ['turnover!', 2]],
  sack: [['sacked!', 2], ["he's taken down!", 2], ['brought down in the backfield!', 2], ['and he gets him!', 2]],
  sack_by: [['taken down by', 1]],
  incomplete: [['and it is incomplete', 1], ['falls incomplete', 1], ['nobody there', 1], ['the pass is incomplete', 1]],
  intended_for: [['intended for', 1]],
  dropped: [['and he drops it!', 1], ['right through his hands', 1], ["can't hang on", 1]],
  broken_up: [['knocked away!', 1], ['broken up!', 1], ['great coverage!', 1], ['batted down!', 1]],
  big_hit: [['oh, what a hit!', 2], ['he got blasted!', 2], ['huge hit!', 2]],
  flag: [['flag on the play', 1], ['there is a flag down', 1], ['and we have a yellow flag', 1]],
  gain_of: [['for a gain of', 1], ['picks up', 1]],
  loss_of: [['for a loss of', 1], ['loses', 1]],
  no_gain: [['and there is no gain', 1], ['and he gets nothing on the play', 1]],
  first_down: [["and that's a first down", 1], ['moves the chains', 1], ['first down!', 1]],
  at_the: [['at the', 1], ['down at the', 1]],
  out_of_bounds: [['and he steps out of bounds', 1], ['pushed out of bounds', 1]],
  kickoff: [["here's the kick", 1], ['and we are underway', 1], ['the kickoff', 1]],
  touchback: [['and that is a touchback', 1], ['into the end zone, touchback', 1]],
  fair_catch: [['he calls for the fair catch', 1], ["he'll fair catch it", 1]],
  punt: [['punts it away', 1], ['the punt is away', 1]],
  fg_up: [['the kick is up', 1], ['here is the kick', 1]],
  fg_good: [['and it is good!', 2], ['right down the middle, good!', 2], ["it's good!", 2]],
  fg_no: [['no good!', 2], ['wide! no good!', 2], ["it's no good!", 2]],
  safety: [["that's a safety!", 2]],
  two_minute: [["we're at the two-minute warning", 1], ['two minutes to go', 1]],
  timeout: [['and that will stop the clock, timeout', 1], ['timeout called', 1]],
  final: [["and that's the ballgame!", 2], ['and that will do it!', 2], ['final whistle!', 2]],
  half: [["that's the half", 1], ['and that will end the half', 1]],
  win: [['win it!', 2], ['come out on top!', 2]],
};
// Yard-line countdown on a breakaway (said fast, big energy) and plain spots.
const COUNTDOWN = [40, 30, 20, 10];

// The analyst (calm-to-warm, between plays).
const COLOR = {
  third_long: ['Third and long. The defense can pin its ears back here.', 'This is a big down. They need a chunk play.', 'Third and long, you have to like the defense here.', 'They have to throw it here, and everybody knows it.'],
  third_short: ['Third and short. Do you trust the run here?', "Short yardage. This is where you find out about your offensive line.", 'Third and short, they should get this.'],
  fourth: ['Fourth down. Big decision coming up.', 'Fourth down. Do they kick it, or go for it?', "Here's where the coach earns his money."],
  red_zone: ['Inside the twenty. The field gets tight down here.', 'Red zone. You have to come away with points.', "Now we'll see what they've got in the red zone."],
  goal_line: ['Goal to go. Everybody in the stadium is standing.', "It's a goal line fight now."],
  late_trailing: ['They need a score, and the clock is the enemy now.', 'Time is running out. Every snap matters.', 'Now is when you find out who wants it.'],
  late_leading: ['A first down here and they can just about put it away.', 'Run the ball, keep the clock moving.', 'Just protect the football here.'],
  late_tied: ['All square, late. This is what you love to see.', "Tie game. Nobody wants to blink."],
  blowout_leading: ['They are in total control of this one.', 'This has been all one way.'],
  blowout_trailing: ['They have a lot of work to do.', 'Nothing has gone right for them today.'],
  after_td: ['What a drive that was.', 'You just cannot leave a man that open.', 'They made that look easy.', 'That was a great call. Right at the weakness of that defense.', 'The crowd is loving this one.'],
  after_int: ['He never saw that defender.', 'That is a terrible decision, and it costs them.', 'Great read by the defense. He was sitting on that route.', 'You cannot throw it into that coverage.'],
  after_sack: ['The protection just broke down.', 'He held it too long, and he paid for it.', 'That was a free rusher. Nobody picked him up.', 'What a get-off by the defensive line.'],
  after_big_run: ['Look at that hole! The line opened it right up.', 'One cut, and he was gone.', 'That is great blocking at the second level.'],
  after_big_catch: ['What a throw, and what a catch.', 'He put it right where only his guy could get it.', 'That is a big-time play in a big spot.'],
  after_drop: ['He has to catch that one.', 'That one is going to sting.'],
  after_breakup: ['Great coverage there. He was right on his hip.', 'He played the ball beautifully.'],
  after_stop: ['That defense is swarming.', 'Great gap discipline right there.', 'They read it the whole way.'],
  after_punt: ['Field position battle now.', 'A good punt there. That pins them back.'],
  after_fg: ["They'll take the points.", 'Points are points. But you want seven there.'],
  drive_moving: ['They are moving the ball at will right now.', 'This offense has found its rhythm.', 'Look at the tempo on this drive.'],
  defense_good: ['That defense is flying around today.', 'The defensive front has been the story of this game.'],
  qb_good: ['The quarterback is seeing the field so well today.', 'He is dealing right now.'],
  general: ['You can feel the energy in this building.', 'Both teams are just trading punches.', 'The weather is not making it easy out there.', 'Lots of football left to play.', 'This crowd is right into it.', 'Physical game, both sides.'],
};

/** Every clip, in recording order (pbp phrases, countdown, spots, gains, names, teams, the analyst). */
export function voiceClips() {
  const clips = [];
  const add = (id, text, voice, energy) => clips.push({ id, text, voice, energy });
  for (const [k, list] of Object.entries(PBP)) list.forEach(([t, e], i) => add(`${k}_${i + 1}`, t, 'pbp', e));
  for (const n of COUNTDOWN) add(`count_${n}`, `the ${numberWords(n)}!`, 'pbp', 2);
  for (let n = 1; n <= 50; n++) add(`yl_${n}`, n === 50 ? 'midfield' : `the ${numberWords(n)}`, 'pbp', 1);
  for (let n = 1; n <= 99; n += n < 30 ? 1 : 5) add(`yds_${n}`, n === 1 ? 'a yard' : `${numberWords(n)} yards`, 'pbp', n >= 20 ? 2 : 1);
  for (const n of LAST_NAMES) add(`name_${slug(n)}`, n, 'pbp', 1);
  for (const t of defaultTeams()) add(`team_${slug(t.name)}`, `the ${t.name}`, 'pbp', 1);
  for (const [k, list] of Object.entries(COLOR)) list.forEach((t, i) => add(`c_${k}_${i + 1}`, t, 'color', 0));
  return clips;
}

/** How many numbered variants a phrase group has (pbp `throw` → 4; analyst `c_after_td` → 5). */
export const VARIANTS = Object.fromEntries([
  ...Object.entries(PBP).map(([k, l]) => [k, l.length]),
  ...Object.entries(COLOR).map(([k, l]) => [`c_${k}`, l.length]),
]);
