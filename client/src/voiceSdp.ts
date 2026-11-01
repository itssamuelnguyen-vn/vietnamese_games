// Asks the other side to send us mono speech at about 24 kbps, and nothing during silences (DTX):
// plenty for voices, and light on phones that send to up to 11 others.
export function tuneOpus(sdp: string): string {
  const pt = /a=rtpmap:(\d+) opus\/48000/i.exec(sdp)?.[1];
  if (!pt) return sdp;
  const want: Record<string, string> = { stereo: '0', 'sprop-stereo': '0', maxaveragebitrate: '24000', usedtx: '1', useinbandfec: '1' };
  const fmtp = new RegExp(`^a=fmtp:${pt} (.*)$`, 'm');
  const merge = (params: string) => {
    const have = new Map(params.split(';').filter(Boolean).map((p) => p.split('=') as [string, string]));
    for (const [k, v] of Object.entries(want)) have.set(k, v);
    return [...have].map(([k, v]) => `${k}=${v}`).join(';');
  };
  if (fmtp.test(sdp)) return sdp.replace(fmtp, (_, params: string) => `a=fmtp:${pt} ${merge(params)}`);
  return sdp.replace(new RegExp(`(a=rtpmap:${pt} opus/48000[^\\r\\n]*)`, 'i'), `$1\r\na=fmtp:${pt} ${merge('')}`);
}
