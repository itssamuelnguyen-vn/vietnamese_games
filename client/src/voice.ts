import { useSyncExternalStore } from 'react';
import type { RoomView, VoiceIceServer, VoiceSignal } from '@vg/shared';
import { socket } from './socket';
import { audioContext } from './sound';
import { loadSetting, saveSetting } from './settings';
import { tuneOpus } from './voiceSdp';

// Voice chat: every member sends their microphone straight to every other member (a WebRTC mesh;
// the server only passes the offers and answers along). STUN finds a direct route between most
// networks; when the server has a TURN relay set up, it hands that out too, for networks that block
// direct routes.
//
// Who hears whom follows the room view's voice.to / voice.from, which the server works out from
// the game's chat routing (ma sói: wolves at night, the accused in their defense, the dead). Your
// microphone is only sent to those allowed to hear you, so nobody else gets your voice at all.

const FALLBACK_ICE: VoiceIceServer[] = [{ urls: ['stun:stun.l.google.com:19302'] }];
// Candidates are gathered before the offer or answer is sent (no trickling), so each pair needs
// just two messages. Gathering normally takes well under a second; this caps it.
const GATHER_MS = 2500;
// A connection that drops and doesn't come back by itself within this long is rebuilt.
const DISCONNECTED_MS = 5000;
const RETRY_MS = [1000, 2000, 4000, 8000, 15000];
const SPEAKING_LEVEL = 0.04;
const VOLUMES_KEY = 'vg:voiceVolumes';
const MIC_KEY = 'vg:voiceMic';
// The room whose voice we were in, so a reload puts us back in it.
const ROOM_KEY = 'vg:voiceRoom';

export type PeerState = 'connecting' | 'connected' | 'failed';

export interface VoiceSnapshot {
  joined: boolean;
  joining: boolean;
  muted: boolean;
  // Testing the microphone without being in voice.
  previewing: boolean;
  error: 'denied' | 'insecure' | 'unsupported' | null;
  peers: Record<string, PeerState>;
  // Members whose voice is coming through (you included) right now.
  speaking: string[];
  // How loud each member plays for you, 0 to 1 (1 when not set).
  volumes: Record<string, number>;
  mics: { id: string; label: string }[];
  micId: string | null;
}

interface Peer {
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  analyser: AnalyserNode | null;
  state: PeerState;
  // The other side's voice session this connection belongs to.
  session: number;
  lost: ReturnType<typeof setTimeout> | null;
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

function loadVolumes(): Record<string, number> {
  try {
    const v = JSON.parse(loadSetting(VOLUMES_KEY) ?? '{}');
    return typeof v === 'object' && v ? v : {};
  } catch {
    return {};
  }
}

class VoiceEngine {
  private snapshot: VoiceSnapshot = {
    joined: false,
    joining: false,
    muted: false,
    previewing: false,
    error: null,
    peers: {},
    speaking: [],
    volumes: loadVolumes(),
    mics: [],
    micId: loadSetting(MIC_KEY),
  };
  private listeners = new Set<() => void>();
  private peers = new Map<string, Peer>();
  private retries = new Map<string, number>();
  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private mic: MediaStream | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private iceServers: VoiceIceServer[] = FALLBACK_ICE;
  private session = 0;
  private room: RoomView | null = null;
  private to = new Set<string>();
  private from = new Set<string>();
  private meter: ReturnType<typeof setInterval> | null = null;
  private buffer = new Uint8Array(512);

  constructor() {
    socket.on('voice:signal', ({ from, data }) => void this.onSignal(from, data));
    // A dropped connection loses the server's record of us: start a new session once back.
    socket.on('connect', () => {
      if (!this.snapshot.joined) return;
      for (const id of [...this.peers.keys()]) this.drop(id);
      this.announce();
    });
    navigator.mediaDevices?.addEventListener?.('devicechange', () => void this.listMics());
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

  // Whether this browser was in this room's voice before a reload.
  wasIn(code: string) {
    return loadSetting(ROOM_KEY) === code;
  }

  private supported(): boolean {
    if (!window.isSecureContext) {
      this.set({ error: 'insecure' });
      return false;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
      this.set({ error: 'unsupported' });
      return false;
    }
    return true;
  }

  private async openMic(): Promise<boolean> {
    if (this.mic) return true;
    const id = this.snapshot.micId;
    const audio: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, ...(id ? { deviceId: { ideal: id } } : {}) };
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({ audio });
    } catch {
      this.set({ error: 'denied' });
      return false;
    }
    this.watchMic();
    for (const t of this.mic.getAudioTracks()) t.enabled = !this.snapshot.muted;
    void this.listMics();
    if (!this.meter) this.meter = setInterval(() => this.measure(), 200);
    return true;
  }

  private watchMic() {
    const ctx = audioContext();
    this.micAnalyser = null;
    if (ctx && this.mic) {
      this.micAnalyser = ctx.createAnalyser();
      ctx.createMediaStreamSource(this.mic).connect(this.micAnalyser);
    }
  }

  private closeMic() {
    for (const t of this.mic?.getTracks() ?? []) t.stop();
    this.mic = null;
    this.micAnalyser = null;
    if (this.meter) clearInterval(this.meter);
    this.meter = null;
  }

  // Device names only show once the page may use the microphone.
  private async listMics() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const mics = devices.filter((d) => d.kind === 'audioinput' && d.deviceId).map((d, i) => ({ id: d.deviceId, label: d.label || `Mic ${i + 1}` }));
      const current = this.mic?.getAudioTracks()[0]?.getSettings().deviceId ?? this.snapshot.micId;
      this.set({ mics, micId: current ?? null });
    } catch {
      // Nothing to list.
    }
  }

  async join(code: string, { auto = false } = {}) {
    if (this.snapshot.joined || this.snapshot.joining || !this.supported()) return;
    this.set({ joining: true, error: null });
    if (!(await this.openMic())) {
      if (auto) this.set({ error: null });
      saveSetting(ROOM_KEY, '');
      return this.set({ joining: false });
    }
    saveSetting(ROOM_KEY, code);
    this.set({ joined: true, joining: false, previewing: false });
    this.announce();
  }

  private announce() {
    socket.emit('voice:join', (r) => {
      if (!r.ok) return;
      this.iceServers = r.iceServers.length ? r.iceServers : FALLBACK_ICE;
      this.session = r.session;
      if (this.room) this.sync(this.room);
    });
  }

  leave() {
    saveSetting(ROOM_KEY, '');
    if (!this.snapshot.joined) return this.stopPreview();
    socket.emit('voice:leave');
    for (const id of [...this.peers.keys()]) this.drop(id);
    for (const t of this.retryTimers.values()) clearTimeout(t);
    this.retryTimers.clear();
    this.retries.clear();
    this.closeMic();
    this.session = 0;
    this.set({ joined: false, joining: false, peers: {}, speaking: [] });
  }

  async startPreview() {
    if (this.snapshot.joined || this.snapshot.previewing || !this.supported()) return;
    if (await this.openMic()) this.set({ previewing: true });
  }

  stopPreview() {
    if (!this.snapshot.previewing) return;
    this.closeMic();
    this.set({ previewing: false });
  }

  toggleMute() {
    const muted = !this.snapshot.muted;
    for (const t of this.mic?.getAudioTracks() ?? []) t.enabled = !muted;
    this.set({ muted });
  }

  setVolume(id: string, volume: number) {
    const volumes = { ...this.snapshot.volumes, [id]: Math.min(1, Math.max(0, volume)) };
    if (volumes[id] === 1) delete volumes[id];
    saveSetting(VOLUMES_KEY, JSON.stringify(volumes));
    this.set({ volumes });
    const peer = this.peers.get(id);
    if (peer) this.route(id, peer);
  }

  // Switches microphone, carrying on every connection with the new one.
  async setMic(id: string) {
    saveSetting(MIC_KEY, id);
    this.set({ micId: id });
    if (!this.mic) return;
    let next: MediaStream;
    try {
      next = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, deviceId: { exact: id } } });
    } catch {
      return this.set({ error: 'denied' });
    }
    const old = this.mic;
    this.mic = next;
    for (const t of next.getAudioTracks()) t.enabled = !this.snapshot.muted;
    this.watchMic();
    for (const [peerId, peer] of this.peers) this.route(peerId, peer);
    for (const t of old.getTracks()) t.stop();
  }

  // How loud the microphone is right now, 0 to about 1 (for the test meter).
  micLevel(): number {
    return this.micAnalyser ? Math.min(1, level(this.micAnalyser, this.buffer) * 4) : 0;
  }

  // Brings the connections in line with the room: one per other member, each sending and playing
  // only what the routing allows, rebuilt when the other side has joined again since.
  sync(room: RoomView) {
    this.room = room;
    this.to = new Set(room.voice.to);
    this.from = new Set(room.voice.from);
    if (!this.snapshot.joined || this.session === 0) return;
    const others = room.voice.members.filter((id) => id !== room.you);
    for (const id of [...this.peers.keys()]) {
      if (!others.includes(id) || (this.peers.get(id)!.session < (room.voice.sessions[id] ?? 0) && this.offers(id))) this.drop(id);
    }
    for (const id of [...this.retries.keys()]) if (!others.includes(id)) this.retries.delete(id);
    // The member with the smaller id makes the offer, so two never cross.
    for (const id of others) if (!this.peers.has(id) && !this.retryTimers.has(id) && this.offers(id)) void this.offer(id);
    for (const [id, peer] of this.peers) this.route(id, peer);
  }

  private offers(id: string) {
    return !!this.room && this.room.you < id;
  }

  private route(id: string, peer: Peer) {
    const track = this.mic?.getAudioTracks()[0] ?? null;
    for (const t of peer.pc.getTransceivers()) {
      if (t.receiver.track.kind !== 'audio' || t.currentDirection === 'stopped') continue;
      const want = this.to.has(id) ? track : null;
      if (t.sender.track !== want) void t.sender.replaceTrack(want).catch(() => {});
    }
    const volume = this.snapshot.volumes[id] ?? 1;
    peer.audio.volume = volume;
    peer.audio.muted = !this.from.has(id) || volume === 0;
  }

  private create(id: string, session: number): Peer {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const audio = new Audio();
    audio.autoplay = true;
    audio.setAttribute('playsinline', '');
    const peer: Peer = { pc, audio, analyser: null, state: 'connecting', session, lost: null };
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      audio.srcObject = stream;
      void audio.play().catch(() => {});
      const ctx = audioContext();
      if (ctx) {
        peer.analyser = ctx.createAnalyser();
        ctx.createMediaStreamSource(stream).connect(peer.analyser);
      }
    };
    pc.onconnectionstatechange = () => {
      if (this.peers.get(id) !== peer) return;
      const s = pc.connectionState;
      if (peer.lost) clearTimeout(peer.lost);
      peer.lost = null;
      if (s === 'connected') {
        peer.state = 'connected';
        this.retries.delete(id);
      } else if (s === 'failed') this.lost(id);
      else if (s === 'disconnected') peer.lost = setTimeout(() => this.lost(id), DISCONNECTED_MS);
      this.publishPeers();
    };
    this.peers.set(id, peer);
    this.publishPeers();
    return peer;
  }

  // A connection that failed is rebuilt after a pause that grows with each try. The side that
  // makes offers starts again; the other side waits for its new offer.
  private lost(id: string) {
    const peer = this.peers.get(id);
    if (!peer) return;
    peer.state = 'failed';
    this.publishPeers();
    if (!this.offers(id)) return;
    const n = this.retries.get(id) ?? 0;
    this.retries.set(id, n + 1);
    clearTimeout(this.retryTimers.get(id));
    this.retryTimers.set(
      id,
      setTimeout(() => {
        this.retryTimers.delete(id);
        if (!this.snapshot.joined || this.peers.get(id) !== peer) return;
        this.drop(id, true);
        if (this.room) this.sync(this.room);
      }, RETRY_MS[Math.min(n, RETRY_MS.length - 1)]),
    );
  }

  private drop(id: string, keepRetries = false) {
    const peer = this.peers.get(id);
    if (!peer) return;
    if (peer.lost) clearTimeout(peer.lost);
    peer.pc.close();
    peer.audio.srcObject = null;
    this.peers.delete(id);
    if (!keepRetries) {
      clearTimeout(this.retryTimers.get(id));
      this.retryTimers.delete(id);
    }
    this.publishPeers();
  }

  private send(to: string, type: 'offer' | 'answer', sdp: string) {
    socket.emit('voice:signal', { to, data: { type, sdp: tuneOpus(sdp), session: this.session } });
  }

  private async offer(id: string) {
    const peer = this.create(id, this.room?.voice.sessions[id] ?? 0);
    peer.pc.addTransceiver('audio', { direction: 'sendrecv' });
    this.route(id, peer);
    try {
      await peer.pc.setLocalDescription(await peer.pc.createOffer());
      await waitForIce(peer.pc);
      if (this.peers.get(id) !== peer) return;
      this.send(id, 'offer', peer.pc.localDescription!.sdp);
    } catch {
      this.lost(id);
    }
  }

  private async onSignal(from: string, data: VoiceSignal) {
    if (!this.snapshot.joined) return;
    if (data.type === 'offer') {
      // An offer from an older session of theirs is stale; a current one replaces what we had.
      if (data.session < (this.room?.voice.sessions[from] ?? 0)) return;
      this.drop(from);
      const peer = this.create(from, data.session);
      try {
        await peer.pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
        for (const t of peer.pc.getTransceivers()) t.direction = 'sendrecv';
        this.route(from, peer);
        await peer.pc.setLocalDescription(await peer.pc.createAnswer());
        await waitForIce(peer.pc);
        if (this.peers.get(from) !== peer) return;
        this.send(from, 'answer', peer.pc.localDescription!.sdp);
      } catch {
        this.lost(from);
      }
    } else {
      const peer = this.peers.get(from);
      if (!peer || peer.pc.signalingState !== 'have-local-offer') return;
      await peer.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp }).catch(() => this.lost(from));
    }
  }

  // Who is talking, for the "speaking" rings: only voices that actually reach you count, and yours
  // only while someone can hear it.
  private measure() {
    const speaking: string[] = [];
    const me = this.room?.you;
    if (me && this.snapshot.joined && this.micAnalyser && !this.snapshot.muted && this.to.size > 0 && level(this.micAnalyser, this.buffer) > SPEAKING_LEVEL) speaking.push(me);
    for (const [id, peer] of this.peers) {
      if (peer.analyser && !peer.audio.muted && level(peer.analyser, this.buffer) > SPEAKING_LEVEL) speaking.push(id);
    }
    if (speaking.join() !== this.snapshot.speaking.join()) this.set({ speaking });
  }
}

export const voice = new VoiceEngine();

export function useVoice(): VoiceSnapshot {
  return useSyncExternalStore(voice.subscribe, voice.get);
}

// Whether one member is speaking, re-rendering only when that changes.
export function useSpeaking(id: string): boolean {
  return useSyncExternalStore(voice.subscribe, () => voice.get().speaking.includes(id));
}
