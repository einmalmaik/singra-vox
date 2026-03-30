/**
 * Singra Vox – Voice Engine
 *
 * P2P WebRTC implementation for small groups (2-6 users).
 * Abstracted so that the transport can be swapped to LiveKit/SFU later
 * without changing the public API.
 *
 * Public interface (stable across transports):
 *   init(deviceId?)  – acquire microphone
 *   joinChannel(channelId, existingPeerIds, sendSignal)
 *   handleSignal(data)  – feed incoming WS signaling messages
 *   toggleMute() → boolean
 *   toggleDeafen() → boolean
 *   setPTT(enabled)
 *   setPTTActive(active)  – key held / released
 *   getAudioLevel() → 0..1
 *   getDevices() → MediaDeviceInfo[]
 *   disconnect()
 *   onStateChange: callback
 */

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

export class VoiceEngine {
  constructor() {
    this.peers = new Map();
    this.localStream = null;
    this.channelId = null;
    this.isMuted = false;
    this.isDeafened = false;
    this.pttEnabled = false;
    this.pttActive = false;
    this._ctx = null;
    this._analyser = null;
    this._lvlBuf = null;
    this._lvlTimer = null;
    this._sendSignal = null;

    /** @type {((info: {type:string, userId?:string, level?:number, peers?:object})=>void)|null} */
    this.onStateChange = null;
  }

  // ── Public API ──────────────────────────────────────────

  async init(deviceId = null) {
    const audio = deviceId
      ? { deviceId: { exact: deviceId } }
      : { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    this.localStream = await navigator.mediaDevices.getUserMedia({ audio });
    this._setupAnalyser();
    this._applyMute();
  }

  joinChannel(channelId, existingUserIds, sendSignal) {
    this.channelId = channelId;
    this._sendSignal = sendSignal;
    for (const uid of existingUserIds) {
      this._createOffer(uid);
    }
  }

  handleSignal(data) {
    switch (data.type) {
      case "voice_offer":
        this._onOffer(data.from_user_id, data.sdp);
        break;
      case "voice_answer":
        this._onAnswer(data.from_user_id, data.sdp);
        break;
      case "voice_ice":
        this._onIce(data.from_user_id, data.candidate);
        break;
      default:
        break;
    }
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    this._applyMute();
    this._emit("mute_change");
    return this.isMuted;
  }

  toggleDeafen() {
    this.isDeafened = !this.isDeafened;
    this.peers.forEach(({ audioEl }) => {
      if (audioEl) audioEl.volume = this.isDeafened ? 0 : 1;
    });
    this._emit("deafen_change");
    return this.isDeafened;
  }

  setPTT(enabled) {
    this.pttEnabled = enabled;
    this._applyMute();
  }

  setPTTActive(active) {
    this.pttActive = active;
    this._applyMute();
  }

  getAudioLevel() {
    if (!this._analyser || !this._lvlBuf) return 0;
    this._analyser.getByteFrequencyData(this._lvlBuf);
    const sum = this._lvlBuf.reduce((a, b) => a + b, 0);
    return Math.min(sum / this._lvlBuf.length / 128, 1);
  }

  async getDevices() {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === "audioinput");
  }

  disconnect() {
    this.peers.forEach(({ pc, audioEl }) => {
      pc.close();
      if (audioEl) { audioEl.pause(); audioEl.srcObject = null; }
    });
    this.peers.clear();
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    if (this._lvlTimer) clearInterval(this._lvlTimer);
    if (this._ctx) this._ctx.close().catch(() => {});
    this._ctx = null;
    this._analyser = null;
    this.channelId = null;
    this._sendSignal = null;
    this._emit("disconnected");
  }

  // ── Internal ────────────────────────────────────────────

  _setupAnalyser() {
    try {
      this._ctx = new AudioContext();
      const src = this._ctx.createMediaStreamSource(this.localStream);
      this._analyser = this._ctx.createAnalyser();
      this._analyser.fftSize = 256;
      src.connect(this._analyser);
      this._lvlBuf = new Uint8Array(this._analyser.frequencyBinCount);
    } catch {
      /* AudioContext not available */
    }
  }

  _applyMute() {
    const muted = this.isMuted || (this.pttEnabled && !this.pttActive);
    this.localStream?.getAudioTracks().forEach((t) => { t.enabled = !muted; });
  }

  _emit(type, extra = {}) {
    this.onStateChange?.({ type, peers: this._peerStates(), ...extra });
  }

  _peerStates() {
    const out = {};
    this.peers.forEach((p, uid) => {
      out[uid] = { state: p.pc.connectionState, hasAudio: !!p.audioEl };
    });
    return out;
  }

  _send(data) {
    this._sendSignal?.(data);
  }

  async _makePeer(userId) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    this.localStream?.getTracks().forEach((t) => pc.addTrack(t, this.localStream));

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this._send({ type: "voice_ice", target_user_id: userId, candidate: e.candidate.toJSON() });
      }
    };

    pc.ontrack = (e) => {
      const el = new Audio();
      el.srcObject = e.streams[0];
      el.volume = this.isDeafened ? 0 : 1;
      el.play().catch(() => {});
      const peer = this.peers.get(userId);
      if (peer) peer.audioEl = el;
      this._emit("peer_connected", { userId });
    };

    pc.onconnectionstatechange = () => this._emit("peer_state", { userId });

    this.peers.set(userId, { pc, audioEl: null });
    return pc;
  }

  async _createOffer(userId) {
    const pc = await this._makePeer(userId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this._send({ type: "voice_offer", target_user_id: userId, sdp: pc.localDescription.toJSON() });
  }

  async _onOffer(fromId, sdp) {
    let peer = this.peers.get(fromId);
    if (!peer) {
      await this._makePeer(fromId);
      peer = this.peers.get(fromId);
    }
    await peer.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await peer.pc.createAnswer();
    await peer.pc.setLocalDescription(answer);
    this._send({ type: "voice_answer", target_user_id: fromId, sdp: peer.pc.localDescription.toJSON() });
  }

  async _onAnswer(fromId, sdp) {
    const peer = this.peers.get(fromId);
    if (peer?.pc.signalingState === "have-local-offer") {
      await peer.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    }
  }

  async _onIce(fromId, candidate) {
    const peer = this.peers.get(fromId);
    if (peer?.pc) {
      try {
        await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch { /* ignore late candidates */ }
    }
  }
}
