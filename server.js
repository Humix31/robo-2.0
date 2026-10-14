const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req,res)=>res.json({ok:true}));
let robot = null; const browsers = new Set();
function send(ws,obj){if(ws && ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify(obj));}
wss.on('connection',(ws,req)=>{
  ws.role = req.url === '/robot' ? 'robot' : 'browser';
  if(ws.role==='robot') { if(robot && robot.readyState===WebSocket.OPEN) robot.close(); robot=ws; send(robot,{type:'stop'}); console.log('ESP32 connected'); for(const b of browsers) send(b,{type:'robot_status',connected:true}); }
  else { browsers.add(ws); send(ws,{type:'robot_status',connected:!!robot && robot.readyState===WebSocket.OPEN}); }
  ws.on('message',raw=>{let m;try{m=JSON.parse(raw.toString())}catch{return}
    if(ws.role==='browser'){
      if(m.type==='stop') send(robot,{type:'stop'});
      if(m.type==='move') send(robot,{type:'move',x:Math.max(-100,Math.min(100,Number(m.x)||0)),y:Math.max(-100,Math.min(100,Number(m.y)||0)),speed:Math.max(0,Math.min(255,Number(m.speed)||0))});
    } else if(m.type==='robot_status') for(const b of browsers) send(b,m);
  });
  ws.on('close',()=>{if(ws.role==='robot'){if(robot===ws){robot=null;for(const b of browsers)send(b,{type:'robot_status',connected:false});}}else{browsers.delete(ws);if(browsers.size===0)send(robot,{type:'stop'});}});
  ws.on('error',e=>console.log('WebSocket error:',e.message));
});
server.listen(process.env.PORT||3000,'0.0.0.0',()=>console.log('VOLT server ready'));
