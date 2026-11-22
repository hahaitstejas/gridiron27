#!/usr/bin/env python3
"""Record Gridiron 27's commentary clips with Chatterbox (Resemble AI, MIT license), on your own computer.

  python3 tools/voices/make_voices.py            # record everything that isn't recorded yet (safe to stop and re-run)
  python3 tools/voices/make_voices.py --only name_   # just the clips whose id starts with name_
  python3 tools/voices/make_voices.py --redo td_1    # record one clip again (delete + record)
  python3 tools/voices/make_voices.py --fake     # no model: beeps instead of speech (tests the pipeline)

Reads voice/lines.json (written by tools/voices/lines.mjs), writes voice/clips/<id>.mp3 and voice/index.json.
Optional voices: put about 10 seconds of a clean recording of a voice you have the right to use (yours, a friend who
agreed) at voice/ref_pbp.wav (play-by-play) and voice/ref_color.wav (analyst). Never a real announcer's voice. Without
them the play-by-play uses Chatterbox's built-in voice and the analyst the same voice lowered in pitch.
Needs ffmpeg (brew install ffmpeg) to trim and compress the clips.
"""
import argparse, json, math, os, shutil, struct, subprocess, sys, time, wave

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
VOICE = os.path.join(ROOT, 'voice')
CLIPS = os.path.join(VOICE, 'clips')
TMP = os.path.join(VOICE, '.tmp')

# How each energy level is delivered (Chatterbox: exaggeration = emotion intensity, cfg_weight = pacing / adherence;
# its README: lower cfg with high exaggeration for dramatic speech).
ENERGY = {0: dict(exaggeration=0.35, cfg_weight=0.55), 1: dict(exaggeration=0.6, cfg_weight=0.45), 2: dict(exaggeration=1.0, cfg_weight=0.3)}


def ffmpeg(args, timeout=60):
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y'] + args, check=True, timeout=timeout)


def finish(wav_path, out_path, analyst_default):
    """Trim the silence at both ends, even out the loudness, mono 24 kHz MP3."""
    chain = [
        'silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.03',
        'areverse', 'silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.06', 'areverse',
    ]
    if analyst_default:  # one built-in voice for both: the analyst a little lower and calmer
        chain += ['asetrate=24000*0.9', 'aresample=24000', 'atempo=1.08']
    try:
        ffmpeg(['-i', wav_path, '-af', ','.join(chain), '-ac', '1', '-ar', '24000', '-b:a', '64k', out_path])
    except (subprocess.TimeoutExpired, subprocess.CalledProcessError):
        # Never let one clip stall a night's recording: keep it untrimmed.
        ffmpeg(['-i', wav_path, '-ac', '1', '-ar', '24000', '-b:a', '64k', out_path])


def fake_wav(path, text, energy):
    """A beep the length of the line (tests the pipeline without the model)."""
    sr, secs = 24000, 0.25 + 0.055 * len(text)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        f = 330 + 110 * energy
        w.writeframes(b''.join(struct.pack('<h', int(9000 * math.sin(2 * math.pi * f * i / sr))) for i in range(int(sr * secs))))


def load_model():
    print('Starting Chatterbox. The first time this sits quiet for a few minutes (Python is warming up): do not press Ctrl+C.', flush=True)
    try:
        import torch, torchaudio  # noqa: F401
        from chatterbox.tts import ChatterboxTTS
    except ImportError:
        sys.exit('Chatterbox is not installed. Run the setup step first (see the README section "Commentary voices").')
    import torch
    device = 'cuda' if torch.cuda.is_available() else 'mps' if torch.backends.mps.is_available() else 'cpu'
    # Apple Silicon: the checkpoints were saved on CUDA, load them onto this device (Chatterbox's own Mac example).
    if device != 'cuda':
        load = torch.load
        torch.load = lambda *a, **k: load(*a, **{**k, 'map_location': torch.device(device)})
    # Chatterbox stamps every clip with Resemble's inaudible Perth watermark. If that library failed to load (it needs
    # pkg_resources: setup.sh pins setuptools<81) fall back to its no-op stand-in instead of crashing.
    import perth
    if perth.PerthImplicitWatermarker is None:
        print('Note: the Perth watermark library did not load (run: .venv-voice/bin/pip install "setuptools<81"); recording without it.')
        perth.PerthImplicitWatermarker = perth.DummyWatermarker
    print(f'Loading Chatterbox on {device} (the first run downloads the model, about 3 GB: wait for it)...', flush=True)
    return ChatterboxTTS.from_pretrained(device=device), device


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--fake', action='store_true')
    ap.add_argument('--only', default='')
    ap.add_argument('--redo', default='')
    ap.add_argument('--limit', type=int, default=0)
    a = ap.parse_args()
    if not shutil.which('ffmpeg'):
        sys.exit('ffmpeg not found. On a Mac: brew install ffmpeg')
    lines = json.load(open(os.path.join(VOICE, 'lines.json')))['clips']
    os.makedirs(CLIPS, exist_ok=True); os.makedirs(TMP, exist_ok=True)
    if a.redo:
        for c in lines:
            if c['id'] == a.redo and os.path.exists(os.path.join(CLIPS, c['id'] + '.mp3')):
                os.remove(os.path.join(CLIPS, c['id'] + '.mp3'))
    todo = [c for c in lines if c['id'].startswith(a.only) and (not a.redo or c['id'] == a.redo)
            and not os.path.exists(os.path.join(CLIPS, c['id'] + '.mp3'))]
    if a.limit: todo = todo[:a.limit]
    print(f'{len(lines)} clips in the script, {len(todo)} to record.')
    refs = {v: os.path.join(VOICE, f'ref_{v}.wav') for v in ('pbp', 'color')}
    refs = {v: p if os.path.exists(p) else None for v, p in refs.items()}
    model = None
    if todo and not a.fake:
        model, _ = load_model()
        import torchaudio
    t0 = time.time()
    for i, c in enumerate(todo):
        tmp = os.path.join(TMP, c['id'] + '.wav')
        if a.fake:
            fake_wav(tmp, c['text'], c['energy'])
        else:
            # Chatterbox reads a clip better as a full sentence: names / numbers get a period.
            text = c['text'] if c['text'][-1] in '.!?,' else c['text'] + '.'
            kw = dict(ENERGY[c['energy']])
            if refs[c['voice']]: kw['audio_prompt_path'] = refs[c['voice']]
            elif c['voice'] == 'color' and refs['pbp']: kw['audio_prompt_path'] = refs['pbp']
            wav = model.generate(text, **kw)
            peak = float(wav.abs().max()) or 1.0
            wav = wav * (0.89 / peak)  # every clip at the same peak level, so stitched calls don't jump in volume
            torchaudio.save(tmp, wav, model.sr)
        finish(tmp, os.path.join(CLIPS, c['id'] + '.mp3'), c['voice'] == 'color' and not refs['color'] and not a.fake)
        os.remove(tmp)
        done = i + 1
        rate = (time.time() - t0) / done
        print(f'[{done}/{len(todo)}] {c["id"]}: {c["text"]}   (~{int(rate * (len(todo) - done) / 60)} min left)', flush=True)
    # The index the game reads: which clips exist.
    have = sorted(f[:-4] for f in os.listdir(CLIPS) if f.endswith('.mp3'))
    json.dump({'version': 1, 'clips': have}, open(os.path.join(VOICE, 'index.json'), 'w'))
    shutil.rmtree(TMP, ignore_errors=True)
    print(f'Done: {len(have)} clips in voice/clips, voice/index.json written.')


if __name__ == '__main__':
    main()
