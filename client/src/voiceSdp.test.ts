import { describe, expect, it } from 'vitest';
import { tuneOpus } from './voiceSdp';

const sdp = ['v=0', 'm=audio 9 UDP/TLS/RTP/SAVPF 111 63', 'a=rtpmap:111 opus/48000/2', 'a=fmtp:111 minptime=10;useinbandfec=1', 'a=rtpmap:63 red/48000/2', ''].join('\r\n');

describe('tuneOpus', () => {
  it('asks for mono speech at a low bitrate with DTX, keeping the other parameters', () => {
    const out = tuneOpus(sdp);
    expect(out).toContain('a=fmtp:111 minptime=10;useinbandfec=1;stereo=0;sprop-stereo=0;maxaveragebitrate=24000;usedtx=1');
    expect(out.match(/a=fmtp:111/g)).toHaveLength(1);
    expect(tuneOpus(out)).toBe(out);
  });

  it('adds the parameters when Opus has none, and leaves SDP without Opus alone', () => {
    const bare = sdp.replace('a=fmtp:111 minptime=10;useinbandfec=1\r\n', '');
    expect(tuneOpus(bare)).toContain('a=rtpmap:111 opus/48000/2\r\na=fmtp:111 stereo=0;sprop-stereo=0;maxaveragebitrate=24000;usedtx=1;useinbandfec=1');
    expect(tuneOpus('v=0\r\nm=audio 9 RTP 0\r\n')).toBe('v=0\r\nm=audio 9 RTP 0\r\n');
  });
});
