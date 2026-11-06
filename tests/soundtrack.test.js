import { describe, it, expect } from 'vitest';
import { parseMusicLink } from '../src/ui/soundtrack.js';

describe('soundtrack links', () => {
  it('reads YouTube Music / YouTube playlist and video links', () => {
    expect(parseMusicLink('https://music.youtube.com/playlist?list=PLabcdefghijklmnop')).toEqual({ list: 'PLabcdefghijklmnop', video: null });
    expect(parseMusicLink('https://www.youtube.com/watch?v=abc123XYZ_-&list=PLzzzzzzzzzzzz')).toEqual({ list: 'PLzzzzzzzzzzzz', video: 'abc123XYZ_-' });
    expect(parseMusicLink('https://youtu.be/abc123XYZ_-')).toEqual({ list: null, video: 'abc123XYZ_-' });
    expect(parseMusicLink('OLAK5uy_abcdefghijklmnop')).toEqual({ list: 'OLAK5uy_abcdefghijklmnop', video: null });
    expect(parseMusicLink('https://example.com/?list=PL123')).toBe(null);
    expect(parseMusicLink('')).toBe(null);
  });
});
