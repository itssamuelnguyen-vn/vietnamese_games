import { useSyncExternalStore } from 'react';
import type { RoomView, VoiceSignal } from '@vg/shared';
import { socket } from './socket';
import { audioContext } from './sound';

// Voice chat: every member sends their microphone straight to every other member (a WebRTC mesh;
// the server only passes the offers and answers along). A free public STUN server finds a direct
// route between home networks; networks that block direct routes would need a TURN relay, which
// isn't set up.
//
// Who hears whom follows the room view's voice.to / voice.from, which the server works out from
// the game's chat routing (ma sói: wolves at night, the accused in their defense, the dead). Your
// microphone is only sent to those allowed to hear you, so nobody else gets your voice at all.

const ICE_SERVERS: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
// Candidates are gathered before the offer or answer is sent (no trickling), so each pair needs
// just two messages. Gathering normally takes well under a second; this caps it.
const GATHER_MS = 2500;
const SPEAKING_LEVEL = 0.04;

export type PeerState = 'connecting' | 'connected' | 'failed';

export interface VoiceSnapshot {
  joined: boolean;
  joining: boolean;
  muted: boolean;
  error: 'denied' | 'insecure' | 'unsupported' | null;
  peers: Record<string, PeerState>;
  // Members whose voice is coming through (you included, as `you`) right now.
  speaking: string[];
}

interface Peer {
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  stream: MediaStream | null;
  analyser: AnalyserNode | null;
  state: PeerState;
}

const waitForIce = (pc: RTCPeerConnection) =>
  new Promise<void>((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', check);
      clearTimeout(timer);
      resolve();
    };
    const check = () => pc.iceGatheringState === 'complete' && done();
    const timer = setTimeout(done, GATHER_MS);
    pc.addEventListener('icegatheringstatechange', check);
  });

function level(analyser: AnalyserNode, buffer: Uint8Array<ArrayBuffer>): number {
  analyser.getByteTimeDomainData(buffer);
  let sum = 0;
  for (const v of buffer) sum += ((v - 128) / 128) ** 2;
  return Math.sqrt(sum / buffer.length);
}

class VoiceEngine {
  private snapshot: VoiceSnapshot = { joined: false, joining: false, muted: false, error: null, peers: {}, speaking: [] };
  private listeners = new Set<() => void>();
  private peers = new Map<string, Peer>();
  private mic: MediaStream | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private me: string | null = null;
  private to = new Set<string>();
  private from = new Set<string>();
  private meter: ReturnType<typeof setInterval> | null = null;
  private buffer = new Uint8Array(512);

  constructor() {
    socket.on('voice:signal', ({ from, data }) => void this.onSignal(from, data));
    // A dropped connection loses the server's record of us; join again once back.
    socket.on('connect', () => {
      if (this.snapshot.joined) socket.emit('voice:join', () => {});
    });
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  get = () => this.snapshot;

  private set(patch: Partial<VoiceSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) l();
  }

  private publishPeers() {
    this.set({ peers: Object.fromEntries([...this.peers].map(([id, p]) => [id, p.state])) });
  }

  async join() {
    if (this.snapshot.joined || this.snapshot.joining) return;
    if (!window.isSecureContext) return this.set({ error: 'insecure' });
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') return this.set({ error: 'unsupported' });
    this.set({ joining: true, error: null });
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      return this.set({ joining: false, error: 'denied' });
    }
    const ctx = audioContext();
    if (ctx) {
      this.micAnalyser = ctx.createAnalyser();
      ctx.createMediaStreamSource(this.mic).connect(this.micAnalyser);
    }
    for (const t of this.mic.getAudioTracks()) t.enabled = !this.snapshot.muted;
    this.meter = setInterval(() => this.measure(), 200);
    this.set({ joined: true, joining: false });
    socket.emit('voice:join', () => {});
  }

  leave() {
    if (!this.snapshot.joined) return;
    socket.emit('voice:leave');
    for (const id of [...this.peers.keys()]) this.drop(id);
    for (const t of this.mic?.getTracks() ?? []) t.stop();
    this.mic = null;
    this.micAnalyser = null;
    if (this.meter) clearInterval(this.meter);
    this.meter = null;
    this.set({ joined: false, joining: false, peers: {}, speaking: [] });
  }

  toggleMute() {
    const muted = !this.snapshot.muted;
    for (const t of this.mic?.getAudioTracks() ?? []) t.enabled = !muted;
    this.set({ muted });
  }

  // Brings the connections in line with the room: one per other member, and each one sending and
  // playing only what the routing allows.
  sync(room: RoomView) {
    this.me = room.you;
    this.to = new Set(room.voice.to);
    this.from = new Set(room.voice.from);
    if (!this.snapshot.joined) return;
    const others = room.voice.members.filter((id) => id !== room.you);
    for (const id of [...this.peers.keys()]) if (!others.includes(id)) this.drop(id);
    // The member with the smaller id makes the offer, so two never cross.
    for (const id of others) if (!this.peers.has(id) && room.you < id) void this.offer(id);
    for (const [id, peer] of this.peers) this.route(id, peer);
  }

  private route(id: string, peer: Peer) {
    const track = this.mic?.getAudioTracks()[0] ?? null;
    for (const t of peer.pc.getTransceivers()) {
      if (t.receiver.track.kind !== 'audio' || t.currentDirection === 'stopped') continue;
      const want = this.to.has(id) ? track : null;
      if (t.sender.track !== want) void t.sender.replaceTrack(want).catch(() => {});
    }
    peer.audio.muted = !this.from.has(id);
  }

  private create(id: string): Peer {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const audio = new Audio();
    audio.autoplay = true;
    audio.setAttribute('playsinline', '');
    const peer: Peer = { pc, audio, stream: null, analyser: null, state: 'connecting' };
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      peer.stream = stream;
      audio.srcObject = stream;
      void audio.play().catch(() => {});
      const ctx = audioContext();
      if (ctx) {
        peer.analyser = ctx.createAnalyser();
        ctx.createMediaStreamSource(stream).connect(peer.analyser);
      }
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      peer.state = s === 'connected' ? 'connected' : s === 'failed' ? 'failed' : peer.state;
      this.publishPeers();
    };
    this.peers.set(id, peer);
    this.publishPeers();
    return peer;
  }

  private drop(id: string) {
    const peer = this.peers.get(id);
    if (!peer) return;
    peer.pc.close();
    peer.audio.srcObject = null;
    this.peers.delete(id);
    this.publishPeers();
  }

  private send(to: string, data: VoiceSignal) {
    socket.emit('voice:signal', { to, data });
  }

  private async offer(id: string) {
    const peer = this.create(id);
    peer.pc.addTransceiver('audio', { direction: 'sendrecv' });
    this.route(id, peer);
    try {
      await peer.pc.setLocalDescription(await peer.pc.createOffer());
      await waitForIce(peer.pc);
      if (this.peers.get(id) !== peer) return;
      this.send(id, { type: 'offer', sdp: peer.pc.localDescription!.sdp });
    } catch {
      peer.state = 'failed';
      this.publishPeers();
    }
  }

  private async onSignal(from: string, data: VoiceSignal) {
    if (!this.snapshot.joined) return;
    if (data.type === 'offer') {
      // A fresh offer (the other side reconnected) replaces whatever we had.
      this.drop(from);
      const peer = this.create(from);
      try {
        await peer.pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
        for (const t of peer.pc.getTransceivers()) t.direction = 'sendrecv';
        this.route(from, peer);
        await peer.pc.setLocalDescription(await peer.pc.createAnswer());
        await waitForIce(peer.pc);
        if (this.peers.get(from) !== peer) return;
        this.send(from, { type: 'answer', sdp: peer.pc.localDescription!.sdp });
      } catch {
        peer.state = 'failed';
        this.publishPeers();
      }
    } else {
      const peer = this.peers.get(from);
      if (!peer || peer.pc.signalingState !== 'have-local-offer') return;
      await peer.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp }).catch(() => {
        peer.state = 'failed';
        this.publishPeers();
      });
    }
  }

  // Who is talking, for the little "speaking" rings: only voices that actually reach you count,
  // and yours only while someone can hear it.
  private measure() {
    const speaking: string[] = [];
    if (this.micAnalyser && !this.snapshot.muted && this.to.size > 0 && level(this.micAnalyser, this.buffer) > SPEAKING_LEVEL && this.me) speaking.push(this.me);
    for (const [id, peer] of this.peers) {
      if (peer.analyser && this.from.has(id) && level(peer.analyser, this.buffer) > SPEAKING_LEVEL) speaking.push(id);
    }
    if (speaking.join() !== this.snapshot.speaking.join()) this.set({ speaking });
  }
}

export const voice = new VoiceEngine();

export function useVoice(): VoiceSnapshot {
  return useSyncExternalStore(voice.subscribe, voice.get);
}
