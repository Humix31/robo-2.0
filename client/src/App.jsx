import { io } from 'socket.io-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CarFront, ChevronRight, LockKeyhole, Signal, Zap } from 'lucide-react';
import { DashboardLayout, TopBar } from './components/DashboardLayout.jsx';
import { DirectionalControls, EmergencyStopButton, SpeedSlider } from './components/VehicleControls.jsx';
import { LiveCamera } from './components/LiveCamera.jsx';
import { BatteryIndicator, ConnectionStatus, EventLog, TelemetryPanel } from './components/Telemetry.jsx';
import { SettingsPanel } from './components/SettingsPanel.jsx';

const initialTelemetry = {
  batteryPercentage: null,
  batteryVoltage: null,
  currentSpeed: null,
  motorStatus: 'N/A',
  wifiSignal: null,
  latencyMs: null,
  receivedAt: null,
};

function now() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('rover-control-token') || (import.meta.env.DEV ? 'local-dev-control-token' : ''));
  const [sessionToken, setSessionToken] = useState(() => localStorage.getItem('rover-control-token') || (import.meta.env.DEV ? 'local-dev-control-token' : ''));
  const [activeSection, setActiveSection] = useState('Dashboard');
  const [socket, setSocket] = useState(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [vehicleConnected, setVehicleConnected] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [mode, setMode] = useState('simulation');
  const [telemetry, setTelemetry] = useState(initialTelemetry);
  const [cameraConnected, setCameraConnected] = useState(false);
  const [cameraConfigured, setCameraConfigured] = useState(false);
  const [speed, setSpeed] = useState(50);
  const [activeDirection, setActiveDirection] = useState('');
  const [emergencyStopped, setEmergencyStopped] = useState(false);
  const [events, setEvents] = useState([]);
  const directionRef = useRef('');
  const socketRef = useRef(null);
  const movementIntervalRef = useRef(null);
  const pushEvent = useCallback((message, type = 'info') => {
    setEvents((current) => [{ id: `${Date.now()}-${Math.random()}`, message, type, time: now() }, ...current].slice(0, 7));
  }, []);

  useEffect(() => {
    fetch('/api/camera/config')
      .then((response) => {
        if (!response.ok) throw new Error(`Camera configuration request failed (${response.status}).`);
        return response.json();
      })
      .then((config) => setCameraConfigured(config.configured))
      .catch((error) => setConnectionError(error.message));
  }, []);

  useEffect(() => {
    if (!sessionToken) return undefined;
    const connection = io({ autoConnect: false, auth: { token: sessionToken }, reconnection: true, reconnectionAttempts: 8, timeout: 8000 });
    socketRef.current = connection;
    setSocket(connection);
    connection.on('connect', () => {
      setSocketConnected(true);
      setConnectionError('');
      connection.emit('vehicle:connect', (result) => {
        setVehicleConnected(result.connected);
        setMode(result.mode);
        pushEvent(result.connected ? `Control link established · ${result.mode} mode` : 'Dashboard connected; vehicle controller is offline', result.connected ? 'success' : 'warning');
      });
    });
    connection.on('connect_error', (error) => {
      setSocketConnected(false);
      setVehicleConnected(false);
      setConnectionError(error.message || 'Connection failed. Check your control token and server.');
      pushEvent(`Connection failed: ${error.message}`, 'error');
    });
    connection.on('disconnect', (reason) => {
      setSocketConnected(false);
      setVehicleConnected(false);
      setActiveDirection('');
      directionRef.current = '';
      setTelemetry(initialTelemetry);
      if (reason !== 'io client disconnect') pushEvent('Control connection lost. Vehicle movement has been stopped.', 'error');
    });
    connection.on('vehicle:status', (status) => {
      setVehicleConnected(Boolean(status.connected));
      setEmergencyStopped(Boolean(status.emergencyStopped));
      setMode(status.mode || 'simulation');
      setTelemetry(status.telemetry || initialTelemetry);
    });
    connection.on('camera:status', (status) => setCameraConnected(Boolean(status.connected)));
    connection.connect();
    return () => {
      connection.emit('vehicle:stop');
      connection.disconnect();
      socketRef.current = null;
    };
  }, [sessionToken, pushEvent]);

  const stopMovement = useCallback(() => {
    if (movementIntervalRef.current) window.clearInterval(movementIntervalRef.current);
    movementIntervalRef.current = null;
    if (directionRef.current && socketRef.current?.connected) socketRef.current.emit('vehicle:stop');
    directionRef.current = '';
    setActiveDirection('');
  }, []);

  const startMovement = useCallback((direction) => {
    if (!socketRef.current?.connected || !vehicleConnected || emergencyStopped || speed === 0 || directionRef.current) return;
    directionRef.current = direction;
    setActiveDirection(direction);
    const sendCommand = () => {
      if (!socketRef.current?.connected || directionRef.current !== direction) return;
      socketRef.current.emit('vehicle:command', { direction, speed }, (result) => {
        if (!result?.ok) {
          stopMovement();
          setConnectionError(result?.error || 'Command rejected.');
          pushEvent(result?.error || 'Command rejected', 'error');
        }
      });
    };
    sendCommand();
    const interval = window.setInterval(() => {
      if (!directionRef.current) {
        window.clearInterval(interval);
        return;
      }
      sendCommand();
    }, 250);
    movementIntervalRef.current = interval;
    setActiveDirection(direction);
  }, [vehicleConnected, emergencyStopped, speed, stopMovement, pushEvent]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
      const keys = { KeyW: 'forward', KeyA: 'left', KeyS: 'reverse', KeyD: 'right' };
      const direction = keys[event.code];
      if (direction) {
        event.preventDefault();
        const currentDirection = directionRef.current;
        if (!event.repeat && !currentDirection) startMovement(direction);
      } else if (event.code === 'Space') {
        event.preventDefault();
        stopMovement();
        socketRef.current?.emit('vehicle:stop');
      }
    };
    const handleKeyUp = (event) => {
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)) stopMovement();
    };
    const loseFocus = () => stopMovement();
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', loseFocus);
    document.addEventListener('visibilitychange', loseFocus);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', loseFocus);
      document.removeEventListener('visibilitychange', loseFocus);
    };
  }, [startMovement, stopMovement]);

  function emergencyStop() {
    stopMovement();
    if (!socketRef.current?.connected) {
      setConnectionError('Cannot send remote emergency stop while disconnected. Use the hardware emergency stop.');
      return;
    }
    socketRef.current.emit('vehicle:emergency-stop');
    setEmergencyStopped(true);
    pushEvent('Emergency stop latched. Movement commands are disabled.', 'error');
  }

  function clearEmergencyStop() {
    if (!window.confirm('Confirm the vehicle is physically safe and the hardware emergency stop is released before clearing the software latch.')) return;
    socketRef.current?.emit('vehicle:reset-emergency-stop', { confirmed: true }, (result) => {
      if (!result?.ok) {
        setConnectionError(result?.error || 'Emergency stop could not be cleared.');
        return;
      }
      setEmergencyStopped(false);
      pushEvent('Emergency stop latch cleared. Vehicle remains stopped.', 'warning');
    });
  }

  function authorize() {
    if (!token.trim()) {
      setConnectionError('Enter an approved control token in Settings.');
      setActiveSection('Settings');
      return;
    }
    setConnectionError('');
    setSessionToken(token.trim());
    if (sessionToken === token.trim()) socketRef.current?.connect();
  }

  function navigate(section) {
    setActiveSection(section);
    const targets = { Camera: 'camera', Controls: 'controls', Telemetry: 'telemetry', Settings: 'settings' };
    if (targets[section]) document.getElementById(targets[section])?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const movementEnabled = socketConnected && vehicleConnected && !emergencyStopped;
  const cameraSourceLabel = import.meta.env.VITE_DEMO_MODE === 'true' ? 'DEMO SOURCE' : cameraConfigured ? 'CAMERA READY' : 'NO SOURCE';
  const displayedSpeed = mode === 'simulation' && typeof telemetry.currentSpeed === 'number' ? telemetry.currentSpeed : 0;

  return (
    <DashboardLayout activeSection={activeSection} onNavigate={navigate}>
      <TopBar connected={vehicleConnected} mode={mode} emergencyStopped={emergencyStopped} onEmergencyStop={emergencyStopped ? clearEmergencyStop : emergencyStop} />
      <div className="dashboard-scroll">
        <div className="welcome-row">
          <div><p className="eyebrow">CONTROL CENTER <span className="heading-slash">/</span> LIVE OPERATIONS</p><h1>Mission dashboard</h1><p className="welcome-copy">Monitor your vehicle and take control in real time.</p></div>
          <div className={`session-indicator ${socketConnected ? 'session-online' : ''}`}><span className="status-dot" /><span><b>{socketConnected ? 'SESSION SECURE' : 'SESSION OFFLINE'}</b><small>{socketConnected ? `AUTHORIZED · ${mode.toUpperCase()}` : 'AUTHENTICATION REQUIRED'}</small></span></div>
        </div>
        {connectionError && <div className="error-banner" role="alert"><AlertTriangle size={16} /><span>{connectionError}</span><button onClick={() => setConnectionError('')} aria-label="Dismiss error">×</button></div>}
        {!socketConnected && <section className="auth-banner">
          <div className="auth-symbol"><LockKeyhole size={18} /></div>
          <div className="auth-copy"><strong>Authorize control session</strong><span>{import.meta.env.DEV ? 'Local simulation token is prefilled. Hardware mode requires an administrator-issued token.' : 'Enter an approved control token in Settings before connecting.'}</span></div>
          <button onClick={authorize}>CONNECT <ChevronRight size={15} /></button>
        </section>}
        {emergencyStopped && <div className="latched-banner"><AlertTriangle size={16} /><span><b>EMERGENCY STOP LATCHED</b> — reset only after physically confirming the vehicle is safe.</span><button onClick={clearEmergencyStop}>CONFIRM RESET</button></div>}
        <section className="metrics-row" aria-label="Vehicle status">
          <div className="metric-card"><span className="metric-icon lime"><CarFront size={18} /></span><span><small>VEHICLE STATUS</small><b>{vehicleConnected ? 'Ready' : 'Offline'}</b></span><i className={vehicleConnected ? 'metric-online' : ''} /></div>
          <div className="metric-card"><span className="metric-icon blue"><BatteryIndicator percentage={telemetry.batteryPercentage} /></span><span><small>BATTERY LEVEL</small><b>{typeof telemetry.batteryPercentage === 'number' ? `${Math.round(telemetry.batteryPercentage)}%` : 'N/A'}</b></span></div>
          <ConnectionStatus connected={socketConnected} latency={telemetry.latencyMs} />
          <div className="metric-card"><span className="metric-icon purple"><Signal size={17} /></span><span><small>CAMERA</small><b>{cameraConnected ? 'Streaming' : cameraSourceLabel}</b></span><i className={cameraConnected ? 'metric-online' : ''} /></div>
        </section>
        <div className="main-grid">
          <div className="primary-column">
            <LiveCamera socket={socket} cameraConnected={cameraConnected} configured={cameraConfigured} />
            <TelemetryPanel telemetry={telemetry} connected={vehicleConnected} cameraConnected={cameraConnected} />
            <EventLog events={events} />
          </div>
          <aside className="control-column" id="controls">
            <section className="panel control-panel">
              <div className="panel-heading"><div><div className="eyebrow">MANUAL OPERATION</div><h2>Drive controls</h2></div><span className={`control-ready ${movementEnabled ? 'ready' : ''}`}><i />{movementEnabled ? 'READY' : 'LOCKED'}</span></div>
              <div className="control-content">
                <div className="control-help"><span>PRESS & HOLD TO MOVE</span><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span></div>
                <DirectionalControls enabled={movementEnabled && speed > 0} activeDirection={activeDirection.split(':')[0]} onStart={startMovement} onStop={stopMovement} />
                <SpeedSlider value={speed} onChange={setSpeed} disabled={!vehicleConnected} />
                <div className="control-readout"><span><i className="tiny-car"><CarFront size={15} /></i> COMMAND OUTPUT</span><b>{displayedSpeed}<small> %</small></b></div>
                <div className="control-quick-info"><span><Zap size={13} /> {speed}% MAX</span><span><span className="kbd-label">SPACE</span> STOP</span></div>
                <button className="full-stop" disabled={!socketConnected} onClick={() => { stopMovement(); socketRef.current?.emit('vehicle:stop'); }}><span>■</span> STOP VEHICLE</button>
              </div>
            </section>
            <section className="safety-card"><span className="safety-icon"><AlertTriangle size={15} /></span><div><b>SAFETY FIRST</b><p>Software stop is not a substitute for a hardware emergency stop. Keep the physical cutoff accessible.</p></div></section>
            <SettingsPanel mode={mode} cameraConfigured={cameraConfigured} token={token} onTokenChange={setToken} />
          </aside>
        </div>
        <footer className="dashboard-footer"><span>ROVEROS <i>·</i> SECURE VEHICLE CONTROL</span><span>LAST TELEMETRY <b>{telemetry.receivedAt ? new Date(telemetry.receivedAt).toLocaleTimeString() : 'N/A'}</b></span><span>SESSION LATENCY <b>{typeof telemetry.latencyMs === 'number' ? `${telemetry.latencyMs} ms` : 'N/A'}</b></span></footer>
      </div>
      <div className="mobile-estop-wrap"><EmergencyStopButton onClick={emergencyStopped ? clearEmergencyStop : emergencyStop} stopped={emergencyStopped} /></div>
    </DashboardLayout>
  );
}
