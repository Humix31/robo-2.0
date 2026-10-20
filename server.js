const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');
require('dotenv').config();
const express = require('express');
const { Server } = require('socket.io');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { serveClient: false });
const port = Number(process.env.PORT || 3000);
const simulationMode = process.env.SIMULATION_MODE !== 'false';
const vehicleMode = simulationMode ? 'simulation' : 'hardware';
const controlToken = process.env.CONTROL_TOKEN || (simulationMode ? 'local-dev-control-token' : '');
const cameraSource = process.env.CAMERA_STREAM_URL || '';
const cameraRoom = 'vehicle-camera';
const stopTimeoutMs = 900;
const robotSockets = new Set();
const dashboardSockets = new Set();
const state = {
  connected: false,
  mode: vehicleMode,
  emergencyStopped: false,
  direction: 'stop',
  speed: 0,
  cameraConnected: false,
  telemetry: {
    batteryPercentage: null,
    batteryVoltage: null,
    currentSpeed: null,
    motorStatus: 'N/A',
    wifiSignal: null,
    latencyMs: null,
    receivedAt: null,
  },
};

if (!simulationMode && !controlToken) {
  throw new Error('CONTROL_TOKEN must be configured when SIMULATION_MODE=false.');
}
if (!simulationMode && !process.env.ROBOT_TOKEN) {
  throw new Error('ROBOT_TOKEN must be configured when SIMULATION_MODE=false.');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function log(event, details = {}) {
  console.info(JSON.stringify({ time: new Date().toISOString(), event, ...details }));
}

function broadcastStatus() {
  io.emit('vehicle:status', { ...state, telemetry: { ...state.telemetry } });
}

function sendRobot(message) {
  for (const socket of robotSockets) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }
}

function stopVehicle(reason) {
  state.direction = 'stop';
  state.speed = 0;
  if (simulationMode) {
    state.telemetry.currentSpeed = 0;
    state.telemetry.motorStatus = 'Idle (simulation)';
  }
  if (!simulationMode) sendRobot({ type: 'stop' });
  log('vehicle.stop', { reason });
  broadcastStatus();
}

const appRoot = path.join(__dirname, 'client', 'dist');
app.use(express.json({ limit: '32kb' }));
app.get('/health', (_request, response) => {
  response.json({ ok: true, mode: vehicleMode, controllerConnected: state.connected });
});
app.get('/api/status', (_request, response) => {
  response.json({
    ...state,
    telemetry: { ...state.telemetry },
    camera: { configured: Boolean(cameraSource), source: cameraSource ? 'configured' : null },
  });
});
app.get('/api/camera/config', (_request, response) => {
  response.json({ configured: Boolean(cameraSource), source: cameraSource || null });
});
app.use(express.static(appRoot));
app.get('*', (_request, response, next) => {
  response.sendFile(path.join(appRoot, 'index.html'), (error) => {
    if (error) next();
  });
});
app.use((error, _request, response, _next) => {
  log('http.error', { message: error.message });
  response.status(error.status || 500).json({ error: 'The request could not be processed.' });
});

io.use((socket, next) => {
  if (controlToken && safeEqual(socket.handshake.auth?.token, controlToken)) {
    socket.data.authorizedAt = Date.now();
    return next();
  }
  next(new Error('Authentication required. Enter an approved control token.'));
});

io.on('connection', (socket) => {
  dashboardSockets.add(socket);
  socket.emit('vehicle:status', { ...state, telemetry: { ...state.telemetry } });
  socket.emit('camera:status', { connected: state.cameraConnected, configured: Boolean(cameraSource) });

  socket.on('vehicle:connect', (...args) => {
    const acknowledge = args.find((argument) => typeof argument === 'function') || (() => {});
    state.connected = simulationMode || robotSockets.size > 0;
    acknowledge({ connected: state.connected, mode: vehicleMode });
    broadcastStatus();
    log('vehicle.connect', { mode: vehicleMode, connected: state.connected });
  });

  socket.on('vehicle:disconnect', () => {
    stopVehicle('dashboard disconnected vehicle');
    state.connected = false;
    broadcastStatus();
  });

  socket.on('vehicle:command', (command, acknowledge = () => {}) => {
    const allowedDirections = new Set(['forward', 'reverse', 'left', 'right']);
    if (!command || !allowedDirections.has(command.direction) ||
        !Number.isInteger(command.speed) || command.speed < 1 || command.speed > 100) {
      acknowledge({ ok: false, error: 'Invalid movement command.' });
      return;
    }
    if (!state.connected || state.emergencyStopped || Date.now() - socket.data.authorizedAt > 15 * 60 * 1000) {
      acknowledge({ ok: false, error: 'Vehicle is disconnected, emergency-stopped, or authorization expired.' });
      return;
    }

    const axes = {
      forward: { x: 0, y: 100 },
      reverse: { x: 0, y: -100 },
      left: { x: -100, y: 0 },
      right: { x: 100, y: 0 },
    }[command.direction];
    state.direction = command.direction;
    state.speed = command.speed;
    if (simulationMode) {
      state.telemetry.currentSpeed = command.speed;
      state.telemetry.motorStatus = 'Running (simulation)';
    } else {
      sendRobot({ type: 'move', ...axes, speed: Math.round(command.speed * 2.55) });
    }
    socket.data.lastMovementAt = Date.now();
    acknowledge({ ok: true });
    broadcastStatus();
  });

  socket.on('vehicle:stop', () => {
    stopVehicle('dashboard requested stop');
  });

  socket.on('vehicle:emergency-stop', () => {
    state.emergencyStopped = true;
    stopVehicle('emergency stop');
    log('vehicle.emergency-stop');
  });

  socket.on('vehicle:reset-emergency-stop', (payload, acknowledge = () => {}) => {
    if (payload?.confirmed !== true || !state.connected) {
      acknowledge({ ok: false, error: 'A connected vehicle and explicit confirmation are required.' });
      return;
    }
    state.emergencyStopped = false;
    state.direction = 'stop';
    state.speed = 0;
    acknowledge({ ok: true });
    broadcastStatus();
    log('vehicle.emergency-stop.reset');
  });

  socket.on('camera:connect', () => {
    socket.join(cameraRoom);
    socket.emit('camera:status', { connected: state.cameraConnected, configured: Boolean(cameraSource) });
  });

  for (const event of ['camera:offer', 'camera:answer', 'camera:ice-candidate']) {
    socket.on(event, (message) => {
      if (message && typeof message === 'object') socket.to(cameraRoom).emit(event, message);
    });
  }
  socket.on('camera:status', (status) => {
    if (typeof status?.connected !== 'boolean') return;
    state.cameraConnected = status.connected;
    io.emit('camera:status', { connected: status.connected, configured: Boolean(cameraSource) });
  });

  socket.on('disconnect', () => {
    dashboardSockets.delete(socket);
    if (socket.data.lastMovementAt) stopVehicle('control connection lost');
    if (dashboardSockets.size === 0 && !simulationMode) stopVehicle('last dashboard disconnected');
  });
});

const robotServer = new WebSocket.Server({ noServer: true });
server.on('upgrade', (request, socket, head) => {
  if (request.url?.split('?')[0] !== '/robot') {
    socket.destroy();
    return;
  }
  if (!simulationMode && !safeEqual(new URL(request.url, 'http://localhost').searchParams.get('token'), process.env.ROBOT_TOKEN)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  robotServer.handleUpgrade(request, socket, head, (websocket) => {
    robotServer.emit('connection', websocket, request);
  });
});

robotServer.on('connection', (socket) => {
  robotSockets.add(socket);
  if (robotSockets.size === 1 && !simulationMode) {
    sendRobot({ type: 'stop' });
    state.connected = true;
    broadcastStatus();
  }
  log('controller.connected', { count: robotSockets.size });

  socket.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch (error) {
      log('controller.invalid-json', { message: error.message });
      return;
    }
    if (message.type === 'robot_status' && typeof message.connected === 'boolean') {
      state.connected = simulationMode ? state.connected : message.connected;
    }
    if (message.type === 'telemetry' || message.type === 'robot_status') {
      const fields = {
        batteryPercentage: message.batteryPercentage,
        batteryVoltage: message.batteryVoltage,
        currentSpeed: message.currentSpeed,
        motorStatus: message.motorStatus,
        wifiSignal: message.wifiSignal,
      };
      for (const [key, value] of Object.entries(fields)) {
        if (key === 'motorStatus' && typeof value === 'string') state.telemetry[key] = value;
        else if (typeof value === 'number' && Number.isFinite(value)) state.telemetry[key] = value;
      }
      state.telemetry.receivedAt = new Date().toISOString();
      broadcastStatus();
    }
  });
  socket.on('close', () => {
    robotSockets.delete(socket);
    if (robotSockets.size === 0 && !simulationMode) {
      state.connected = false;
      stopVehicle('vehicle controller disconnected');
      broadcastStatus();
    }
    log('controller.disconnected', { count: robotSockets.size });
  });
  socket.on('error', (error) => log('controller.error', { message: error.message }));
});

setInterval(() => {
  for (const socket of dashboardSockets) {
    if (socket.data.lastMovementAt && Date.now() - socket.data.lastMovementAt > stopTimeoutMs) {
      delete socket.data.lastMovementAt;
      stopVehicle('movement dead-man timeout');
    }
  }
}, 200);

if (simulationMode) {
  setInterval(() => {
    if (!state.connected) return;
    state.telemetry.batteryPercentage = 87;
    state.telemetry.batteryVoltage = 7.8;
    state.telemetry.currentSpeed = state.speed;
    state.telemetry.motorStatus = state.direction === 'stop' ? 'Idle (simulation)' : 'Running (simulation)';
    state.telemetry.wifiSignal = -48;
    state.telemetry.latencyMs = Math.round(12 + Math.random() * 8);
    state.telemetry.receivedAt = new Date().toISOString();
    broadcastStatus();
  }, 1500);
}

server.listen(port, '0.0.0.0', () => log('server.ready', { port, mode: vehicleMode }));
