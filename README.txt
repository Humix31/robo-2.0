ROBO 2.0 - ROBOT RACING CONTROLLER

Architecture
------------
The deployed website connects to the Node.js WebSocket relay on Render.
The ESP32 connects to the same relay at:

  wss://robo-2-0.onrender.com/robot

The browser uses one WebSocket connection to the relay and receives
robot_status messages. The relay forwards the existing movement protocol:

  {"type":"move","x":0,"y":100,"speed":255}
  {"type":"stop"}

The movement axes remain in the -100..100 range. The speed slider selects
a maximum from 20% to 100%, mapped to PWM 51..255. Normal button/keyboard
driving uses 70% of that selected maximum; holding BOOST uses the full
selected maximum. A 100% maximum therefore sends speed 255 while boosting.
Steering sensitivity scales the x-axis in the browser and does not alter
the WebSocket message format.

PWM / ESP32 FIRMWARE
--------------------
The relay accepts and forwards speed values up to 255. This repository
does not contain the ESP32 sketch, so the firmware's motor-control code
cannot be inspected here. The repository therefore cannot establish
whether the firmware uses the full 0..255 range or clamps requests to 200
(or another limit).

Before driving at 100%, inspect the ESP32 command handler for a clamp such
as `min(requestedSpeed, 200)` or `const int MAX_SPEED = 200`. If present,
change only the speed limit to 255 and make sure its PWM API accepts
0..255. Do not change motor direction settings, GPIO assignments, Wi-Fi
credentials, or STBY configuration for this website update.

The GPIO assignments supplied for this project are AIN1=23, AIN2=22,
PWMA=21, BIN1=19, BIN2=18, and PWMB=13. They are not verified against
firmware in this repository.

DEPLOY
------
1. Push the project to its GitHub repository.
2. Render uses `render.yaml`, runs `npm install`, then `npm start`.
3. Confirm the Render service is live and the ESP32 has connected to the
   `/robot` WebSocket endpoint before testing the controls.

SAFETY
------
This is a prototype relay without user authentication. Use a clear,
unobstructed test area, keep the robot supported or wheels clear for the
first tests, and keep access to motor power. The browser sends STOP when
the final browser disconnects, and a newly connected ESP32 receives STOP
before the relay reports it connected. If the robot disconnects, its
firmware timeout remains the final protection; the website cannot stop a
robot over a broken connection.
