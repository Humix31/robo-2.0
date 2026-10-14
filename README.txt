VOLT CLOUD ROBOT CONTROLLER

This architecture is: deployed webpage <-> Node.js WebSocket relay on Render <-> ESP32 over secure WebSocket.
The ESP32 does NOT create its own Wi-Fi hotspot in this version. The ESP32 connects to a normal internet-enabled 2.4 GHz Wi-Fi network. The browser can access the deployed website from anywhere with internet, while the robot must also be online.

DEPLOY BACKEND + WEBSITE
1. Upload the contents of this folder to a GitHub repository (preserve public/ and esp32/ folders).
2. In Render, create a Web Service from that repository.
3. Build command: npm install. Start command: npm start.
4. Deploy and wait for the service to become Live. The website will be https://YOUR-SERVICE.onrender.com.
5. In esp32/VOLT_Cloud_Robot.ino set BACKEND_HOST to the Render hostname only, e.g. volt-robot-controller.onrender.com (no https://).
6. Set WIFI_SSID and WIFI_PASSWORD to your normal internet-enabled Wi-Fi credentials. Most classic ESP32 boards need 2.4 GHz Wi-Fi. A compatible 2.4 GHz phone hotspot can also be used.
7. In Arduino IDE install libraries: WebSockets by Markus Sattler (arduinoWebSockets) and ArduinoJson by Benoit Blanchon. Use ESP32 Arduino Core 3.x for ledcAttach/ledcWrite pin API.
8. Upload the ESP32 sketch. Open Serial Monitor at 115200. It should report Wi-Fi connected and then Cloud backend connected.
9. Open the Render website; it should show ESP32 connected.

IMPORTANT SAFETY / LIMITATIONS
- This is a prototype relay without user authentication. Do not leave a powered robot unattended; add authentication before public use.
- Render free services may sleep when idle, so first connection can take a short while.
- setInsecure() encrypts TLS but skips certificate validation; prototype only.
- GPIO mapping (PWMA 18, AIN1 4, AIN2 25, PWMB 23, BIN1 13, BIN2 19) is assumed, not verified for your TTRO LF6.0 board. Verify wiring before connecting motor power.
- TB6612FNG STBY must be HIGH, motor supply must be correct, and ESP32/motor driver grounds must be common. Never apply 5 V to ESP32 GPIO.
