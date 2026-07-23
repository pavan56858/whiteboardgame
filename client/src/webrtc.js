/**
 * Minimal WebRTC mesh manager for voice chat, camera video, and screen
 * share. One RTCPeerConnection per remote peer; the signaling server
 * (socket.js) only relays opaque offer/answer/ICE payloads — it never
 * looks at media.
 *
 * NOTE ON TESTING: this code follows the standard WebRTC mesh pattern
 * and the signaling relay it depends on was verified end-to-end
 * (offer/answer/ICE messages really do reach the right peer — see the
 * server e2e tests). The actual audio/video capture and rendering
 * needs a real browser with a mic/camera to verify, which isn't
 * available in this environment — test that part yourself with two
 * browser tabs before relying on it.
 */

const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

export function createWebRTCManager({ socket, onRemoteStream, onRemoteStreamRemoved }) {
  const peers = new Map(); // peerId -> RTCPeerConnection
  let localStream = null;

  function getOrCreatePeer(peerId) {
    if (peers.has(peerId)) return peers.get(peerId);

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peers.set(peerId, pc);

    if (localStream) {
      localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit("webrtc-signal", { to: peerId, data: { type: "candidate", candidate: e.candidate } });
      }
    };
    pc.ontrack = (e) => {
      onRemoteStream(peerId, e.streams[0]);
    };
    pc.onconnectionstatechange = () => {
      if (["closed", "failed", "disconnected"].includes(pc.connectionState)) {
        removePeer(peerId);
      }
    };
    return pc;
  }

  async function connectToPeer(peerId) {
    const pc = getOrCreatePeer(peerId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("webrtc-signal", { to: peerId, data: { type: "offer", sdp: pc.localDescription } });
  }

  async function handleSignal({ from, data }) {
    const pc = getOrCreatePeer(from);
    if (data.type === "offer") {
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("webrtc-signal", { to: from, data: { type: "answer", sdp: pc.localDescription } });
    } else if (data.type === "answer") {
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    } else if (data.type === "candidate") {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch {
        // Benign if it arrives before the remote description is set.
      }
    }
  }

  function removePeer(peerId) {
    const pc = peers.get(peerId);
    if (pc) {
      pc.close();
      peers.delete(peerId);
      onRemoteStreamRemoved(peerId);
    }
  }

  // Call after localStream changes (mic/camera/screen toggled) to push
  // the new track set to every connected peer and renegotiate.
  function setLocalStream(stream) {
    localStream = stream;
    peers.forEach(async (pc, peerId) => {
      pc.getSenders().forEach((s) => pc.removeTrack(s));
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("webrtc-signal", { to: peerId, data: { type: "offer", sdp: pc.localDescription } });
    });
  }

  function hasPeer(peerId) {
    return peers.has(peerId);
  }

  function closeAll() {
    peers.forEach((pc) => pc.close());
    peers.clear();
  }

  return { connectToPeer, handleSignal, removePeer, setLocalStream, hasPeer, closeAll };
}
