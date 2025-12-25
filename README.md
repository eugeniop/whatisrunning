# Train Display

A tiny Express + WebSocket app that shows a live list of running model trains. An admin page lets you register trains as running or stopped, and the public display updates instantly. Runs are stored in a local SQLite database so you can review daily activity later.

## How it works

- **Pages**: `/` shows the public display, `/admin` is for adding/stopping trains, and `/activity` shows all runs for a selected day.
- **Live updates**: Changes in the admin UI broadcast over WebSockets so the visitor display stays in sync without refreshes.
- **Data**: Trains and run history are kept in `trains.db` (SQLite) via `better-sqlite3`. Each update also writes a run record so you can report on past days.
- **API**: `/api/running` manages the current running list (GET/POST/PATCH/DELETE) and `/api/reports/runs?date=YYYY-MM-DD` returns historical runs.

## Operating the app

1. Start the server (see platform-specific steps below).
2. Visit `/admin` to add a running train. Required fields: name, railway, country (emoji flag), power type, train type, year range, and location.
3. The public display at `/` updates immediately. Use the **Stop** action in `/admin` to end a run and remove it from the live board.
4. Visit `/activity` and pick a date to see all runs for that day with durations.

## Running on macOS

1. Install Node.js (e.g., `brew install node`).
2. Install dependencies: `npm install`.
3. Start the server: `npm start` (optionally `PORT=4000 npm start` to change the port).
4. Open http://localhost:3000 (or your chosen port) and use `/admin` to manage trains.

## Running on a dedicated Raspberry Pi

1. Install prerequisites:
   - Node.js 18+ (for ARM64/ARMv7 you can use NodeSource: `curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -` then `sudo apt-get install -y nodejs`).
   - Build tools for `better-sqlite3`: `sudo apt-get install -y build-essential python3 make g++`.
2. In the project directory, install dependencies: `npm install --production`.
3. Start the server: `PORT=3000 npm start`. The app listens on all interfaces, so other devices on the network can connect.
4. Optional: create a `systemd` unit for auto-start on boot:

   ```ini
   [Unit]
   Description=Train Display
   After=network.target

   [Service]
   WorkingDirectory=/home/pi/whatisrunning
   ExecStart=/usr/bin/env PORT=3000 /usr/bin/node /home/pi/whatisrunning/server.js
   Restart=always
   Environment=NODE_ENV=production

   [Install]
   WantedBy=multi-user.target
   ```

   Save as `/etc/systemd/system/traindisplay.service`, then run `sudo systemctl daemon-reload && sudo systemctl enable --now traindisplay`.

Database files (`trains.db`) live alongside the code; back up that file if you need to preserve history across reinstalls.
