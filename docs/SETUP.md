# Setup

This file used to start the lead desk. That board is no longer the product in this repo. See `docs/HANDOFF_BOUNDARY.md`. `npm run dev` now starts the Buyer Command Center. Do not set `ENABLE_LEAD_DESK`.

# Setup (lead-desk experiment, unmounted)

You do this on your own computer, in Cursor, or in any folder that has this project. The desk stays on that computer. It does not go live on the internet.

## 1. Install Node

1. Open [https://nodejs.org](https://nodejs.org).
2. Download the current Node 22 installer for your computer.
3. Run the installer. Accept the defaults.
4. Expected result: Node is installed. You do not need an account.

## 2. Get the project

1. In Cursor, open this repository.
2. Switch to the branch that contains Kleinman Desk (the pull request branch).
3. Expected result: you can see a `backend` folder and a `docs` folder.

## 3. Install the desk

1. In Cursor, open the terminal (Terminal menu, then New Terminal).
2. Paste this and press Enter:

```bash
cd backend && npm install
```

3. Expected result: the command finishes without a red error. The first run can take a minute.

## 4. Optional: read screenshots

Skip this if you are willing to paste the text from a screenshot.

1. On a Mac, install Tesseract from the terminal only if you already use Homebrew:

```bash
brew install tesseract
```

2. On Windows, use the installer from the Tesseract project and leave the default path.
3. Expected result: a screenshot can be read. If this program is missing, the desk tells you and asks you to paste the text. That is a normal fallback, not a crash.

## 5. Start it

1. In the same terminal, paste:

```bash
cd backend && npm run dev
```

If you are already in `backend`, paste only `npm run dev`.

2. Expected result: a line that says `Kleinman Desk at http://127.0.0.1:8080`.
3. Open Chrome or Safari and go to `http://127.0.0.1:8080`.
4. Expected result: a page titled Kleinman Desk. It says nothing is waiting, or it shows demo people if you added them.

## 6. See a practice day

1. Tap **Settings**.
2. Tap **Add demo examples**.
3. Tap **Today**.
4. Expected result: a dark card saying who needs you, a banner that the people are DEMO, and a red note that Redfin is not connected. No text message is sent.

## 7. Stop it

1. Click the terminal.
2. Press Control+C.
3. Expected result: the page stops loading. Your leads remain in `backend/data` on that computer.

## Do not

- Do not paste Redfin passwords into chat.
- Do not upload a real client screenshot until you are comfortable this copy stays on your computer.
- Do not set `HOST=0.0.0.0` on a shared network.
- Do not commit the `backend/data` folder. It is ignored on purpose.
- GitHub Pages, if it is turned on for this repository, publishes the code. It does not run this desk. Use the local address above for real work.
