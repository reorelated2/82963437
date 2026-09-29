# Setup

## KyleOS Command (`ops/`)

You need Node.js 22 or newer. You do not need a database account. Do this on your own computer. The desk stays on that computer. It does not go live on the internet.

### 1. Install Node

1. Open [https://nodejs.org](https://nodejs.org).
2. Download the installer labeled LTS or Current, as long as it is version 22 or newer.
3. Run the installer and accept the defaults.
4. Open Terminal on a Mac, or PowerShell on Windows.

Expected result: this command prints `v22` or higher.

```bash
node -v
```

### 2. Open the project

1. In Terminal, go to the folder that contains this project.
2. Paste:

```bash
cd ops
npm install
npm run typecheck
npm test
npm start
```

`npm run typecheck` should finish with no errors. `npm test` should finish with the count recorded in `docs/TEST_RESULTS.md` for this branch.

Expected result of `npm start`: a line that says `KyleOS Command (kleinman-lead-desk) running at http://127.0.0.1:8787`.

Leave that window open. Closing it stops the desk.

The desk listens only on this computer. To use a different local password, set `OPS_PASSWORD` in that same window before `npm start`.

### 3. Sign in

1. Open Chrome or Safari.
2. Click the address bar.
3. Paste `http://127.0.0.1:8787` and press Return.
4. Type the local password. The default is `local-kyle`.
5. Click **Open the board**.

Expected result: the page title is KyleOS Command. The package name kleinman-lead-desk is under the title. A banner says Redfin stays the system of record. A wrong password stays on the sign-in screen.

### 4. Optional: read screenshots

Screenshot reading uses Tesseract, a free local program.

Mac:

```bash
brew install tesseract
```

Windows: install the Tesseract app from its official installer, then restart Terminal and run `npm start` again.

If Tesseract is missing, paste the text instead. The desk will say screenshot reading is unavailable and it will not invent a contact.

### 5. See a sample day

1. On the desk, click **Load sample day**.
2. Expected result: DEMO labels appear on Nate Alvarez, Maria Chen, Jordan Hale, Sam Ortiz, and Pat Nguyen. Pat Nguyen is under **No next action**. **Recent replies** says the connector is blocked. **System health** lists Redfin Partner Tools, MLS, ShowingTime, Quo SMS, and Gmail import as disconnected. Those people are fake. A picture of this board is in `docs/screenshots/command-board.png`.

Click **Remove sample records** before you rely on the desk for a real client. Sample rows are stored in the same file, and they are marked so you can tell them apart.

### If the page does not load

1. Check the Terminal window is still running.
2. Confirm the address is `http://127.0.0.1:8787` and not a public website.
3. If the port is busy, stop the old window and run `npm start` again.

## Buyer Command Center (`backend/` and `mobile/`)

This is the consult, market, and MLS-helper app. It is not the inquiry board. Leave `ENABLE_LEAD_DESK` unset. See `docs/HANDOFF_BOUNDARY.md`.

You do this on your own computer. The server stays on that computer.

### Install and start

1. Open this repository and stay on the branch you intend to run.
2. In the terminal:

```bash
cd backend && npm install
npm run dev
```

If you are already in `backend`, paste only `npm run dev`.

Expected result: the consult server listens on `http://127.0.0.1:8080`. `GET /` describes the Buyer Command Center. It does not serve the KyleOS board.

The Expo app is separate:

```bash
cd mobile
npm install
npm run start
```

### Optional screenshot reader for the unmounted experiment

Skip this if you paste text. On a Mac, install Tesseract only if you already use Homebrew:

```bash
brew install tesseract
```

On Windows, use the installer from the Tesseract project and leave the default path. If the program is missing, paste the text. That is a normal fallback, not a crash.

### Practice day for the unmounted experiment

These clicks apply only if that experiment is mounted. The consult server does not mount it.

1. Tap **Settings**.
2. Tap **Add demo examples**.
3. Tap **Today**.
4. Expected result: a dark card saying who needs you, a banner that the people are DEMO, and a red note that Redfin is not connected. No text message is sent.

### Stop it

1. Click the terminal.
2. Press Control+C.
3. Expected result: the page stops loading. Consult-app data remains in `backend/data` on that computer. KyleOS data remains in `ops/data`.

### Do not

- Do not paste Redfin passwords into chat.
- Do not upload a real client screenshot until you are comfortable this copy stays on your computer.
- Do not set `HOST=0.0.0.0` or `OPS_HOST=0.0.0.0` on a shared network.
- Do not commit `backend/data` or `ops/data` database files. They are ignored on purpose.
- Do not set `ENABLE_LEAD_DESK`.
- GitHub Pages, if it is turned on for this repository, publishes static files. It does not run either desk. Use the local addresses above for real work.
