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
npm start
```

Expected result: a line that says `Kleinman Desk running at http://127.0.0.1:8787`.

Leave that window open. Closing it stops the desk.

## 3. Open the desk

1. Open Chrome or Safari.
2. Click the address bar.
3. Paste `http://127.0.0.1:8787` and press Return.

Expected result: the page title is Kleinman Desk. The top line is about who needs attention. A banner says Redfin stays the system of record.

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
2. Expected result: DEMO labels appear. Those people are fake.

Click **Remove sample records** before you rely on the desk for a real client. Sample rows are stored in the same file, and they are marked so you can tell them apart.

## If the page does not load

1. Check the Terminal window is still running.
2. Confirm the address is `http://127.0.0.1:8787` and not a public website.
3. If the port is busy, stop the old window and run `npm start` again.
