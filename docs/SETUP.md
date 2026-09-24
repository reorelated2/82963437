# Setup

You need Node.js 22 or newer. You do not need a database account.

## 1. Install Node

1. Open [https://nodejs.org](https://nodejs.org).
2. Download the installer labeled LTS or Current, as long as it is version 22 or newer.
3. Run the installer and accept the defaults.
4. Open Terminal on a Mac, or PowerShell on Windows.

Expected result: this command prints `v22` or higher.

```bash
node -v
```

## 2. Open the project

1. In Terminal, go to the folder that contains this project.
2. Paste:

```bash
cd ops
npm install
npm run typecheck
npm test
npm start
```

`npm run typecheck` should finish with no errors. `npm test` should finish with 25 passed and 0 failed.

Expected result of `npm start`: a line that says `KyleOS Command (kleinman-lead-desk) running at http://127.0.0.1:8787`.

Leave that window open. Closing it stops the desk.

The desk listens only on this computer. To use a different local password, set `OPS_PASSWORD` in that same window before `npm start`.

## 3. Sign in

1. Open Chrome or Safari.
2. Click the address bar.
3. Paste `http://127.0.0.1:8787` and press Return.
4. Type the local password. The default is `local-kyle`.
5. Click **Open the board**.

Expected result: the page title is KyleOS Command. The package name kleinman-lead-desk is under the title. A banner says Redfin stays the system of record. A wrong password stays on the sign-in screen.

## 4. Optional: read screenshots

Screenshot reading uses Tesseract, a free local program.

Mac:

```bash
brew install tesseract
```

Windows: install the Tesseract app from its official installer, then restart Terminal and run `npm start` again.

If Tesseract is missing, paste the text instead. The desk will say screenshot reading is unavailable and it will not invent a contact.

## 5. See a sample day

1. On the desk, click **Load sample day**.
2. Expected result: DEMO labels appear on Nate Alvarez, Maria Chen, Jordan Hale, Sam Ortiz, and Pat Nguyen. Pat Nguyen is under **No next action**. **Recent replies** says the connector is blocked. **System health** lists Redfin Partner Tools, MLS, ShowingTime, Quo SMS, and Gmail import as disconnected. Those people are fake. A picture of this board is in `docs/screenshots/command-board.png`.

Click **Remove sample records** before you rely on the desk for a real client. Sample rows are stored in the same file, and they are marked so you can tell them apart.

## If the page does not load

1. Check the Terminal window is still running.
2. Confirm the address is `http://127.0.0.1:8787` and not a public website.
3. If the port is busy, stop the old window and run `npm start` again.
