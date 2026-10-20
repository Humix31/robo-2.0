import { Maximize2, Radio, RefreshCw, VideoOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export function LiveCamera({ socket, cameraConnected, configured }) {
  const videoRef = useRef(null);
  const peerRef = useRef(null);
  const [timestamp, setTimestamp] = useState('--:--:--');
  const [error, setError] = useState('');
  const demoEnabled = import.meta.env.VITE_DEMO_MODE === 'true';
  const demoUrl = import.meta.env.VITE_DEMO_VIDEO_URL || '';

  useEffect(() => {
    const tick = () => setTimestamp(new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date()));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!socket) return undefined;
    const handleAnswer = async ({ sdp }) => {
      if (!peerRef.current || !sdp) return;
      try {
        await peerRef.current.setRemoteDescription(new RTCSessionDescription(sdp));
      } catch (caught) {
        setError(`Camera negotiation failed: ${caught.message}`);
      }
    };
    const handleCandidate = async ({ candidate }) => {
      if (!peerRef.current || !candidate) return;
      try { await peerRef.current.addIceCandidate(new RTCIceCandidate(candidate)); }
      catch (caught) { setError(`Camera network candidate failed: ${caught.message}`); }
    };
    socket.on('camera:answer', handleAnswer);
    socket.on('camera:ice-candidate', handleCandidate);
    return () => {
      socket.off('camera:answer', handleAnswer);
      socket.off('camera:ice-candidate', handleCandidate);
    };
  }, [socket]);

  async function reconnect() {
    setError('');
    if (!socket?.connected) {
      setError('Authorize and connect the control session before reconnecting the camera.');
      return;
    }
    if (!configured) {
      setError('No camera source is configured. Set CAMERA_STREAM_URL and restart the server.');
      return;
    }
    peerRef.current?.close();
    let iceServers = [];
    try {
      iceServers = import.meta.env.VITE_ICE_SERVERS ? JSON.parse(import.meta.env.VITE_ICE_SERVERS) : [];
      if (!Array.isArray(iceServers)) throw new Error('ICE server configuration must be a JSON array.');
    } catch (caught) {
      setError(`Invalid VITE_ICE_SERVERS configuration: ${caught.message}`);
      return;
    }
    const peer = new RTCPeerConnection({ iceServers });
    peerRef.current = peer;
    peer.ontrack = (event) => { if (videoRef.current) videoRef.current.srcObject = event.streams[0]; };
    peer.onicecandidate = (event) => {
      if (event.candidate) socket.emit('camera:ice-candidate', { candidate: event.candidate.toJSON() });
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'failed') setError('Camera connection failed. Check the camera bridge and network.');
    };
    try {
      const offer = await peer.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: false });
      await peer.setLocalDescription(offer);
      socket.emit('camera:connect');
      socket.emit('camera:offer', { sdp: peer.localDescription, source: configured });
    } catch (caught) {
      setError(`Could not start the camera connection: ${caught.message}`);
    }
  }

  async function fullscreen() {
    try {
      if (!document.fullscreenElement) await videoRef.current?.parentElement?.requestFullscreen();
      else await document.exitFullscreen();
    } catch (caught) {
      setError(`Fullscreen is unavailable: ${caught.message}`);
    }
  }

  useEffect(() => () => peerRef.current?.close(), []);

  return (
    <section className="panel camera-panel" id="camera">
      <div className="panel-heading camera-heading">
        <div><div className="eyebrow">LIVE CAMERA</div><h2>Vehicle view</h2></div>
        <div className="camera-actions">
          <span className={`camera-status ${cameraConnected ? 'camera-online' : ''}`}><span />{cameraConnected ? 'STREAM LIVE' : 'NO SIGNAL'}</span>
          <button className="icon-button" onClick={reconnect} aria-label="Reconnect camera"><RefreshCw size={15} /></button>
          <button className="icon-button" onClick={fullscreen} aria-label="Fullscreen camera"><Maximize2 size={15} /></button>
        </div>
      </div>
      <div className="camera-viewport">
        {demoEnabled && demoUrl
          ? <video ref={videoRef} className="camera-video" src={demoUrl} autoPlay muted loop playsInline />
          : <video ref={videoRef} className="camera-video" autoPlay muted playsInline />}
        {!cameraConnected && !(demoEnabled && demoUrl) && (
          <div className="camera-placeholder">
            <div className="camera-placeholder-icon"><VideoOff size={23} /></div>
            <strong>Camera feed unavailable</strong>
            <span>{configured ? 'Connect a camera bridge to start the live WebRTC stream.' : 'Configure a camera source to enable live streaming.'}</span>
            <button onClick={reconnect}><RefreshCw size={14} /> RECONNECT CAMERA</button>
            {error && <p className="inline-error">{error}</p>}
          </div>
        )}
        {demoEnabled && demoUrl && <span className="demo-watermark">DEMO VIDEO</span>}
        {cameraConnected && <div className="recording-indicator"><Radio size={12} /> LIVE</div>}
        <span className="camera-time">{timestamp}</span>
        <span className="camera-label">CAM-01 <i /> FRONT CAMERA</span>
        {!cameraConnected && error && !(demoEnabled && demoUrl) && <p className="camera-error">{error}</p>}
      </div>
      <div className="camera-footer"><span><i className={cameraConnected ? 'signal-good' : ''} />{cameraConnected ? 'WEBRTC · CONNECTED' : 'WEBRTC · DISCONNECTED'}</span><span>{configured ? 'SOURCE CONFIGURED' : 'SOURCE NOT CONFIGURED'}</span></div>
    </section>
  );
}
