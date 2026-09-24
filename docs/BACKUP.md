# Backup and recovery

The desk keeps one file: `ops/data/desk.sqlite`. Copying that file is the backup. Do this while the desk is stopped so the copy is clean. The command below also works while it is stopped.

## Make a backup

1. Open Terminal in the project folder.
2. Paste:

```bash
cd ops
npm run backup
```

Expected result: a line that starts with `Backup written to` and ends in `ops/data/backups/kleinman-desk-....sqlite`.

While the desk is running you can also download a copy from `http://127.0.0.1:8787/api/backup`. Save that file somewhere outside the project. Restore still happens in Terminal, with the desk stopped.

## Restore

1. Stop the desk. In the Terminal window that says it is running, press Control+C.
2. Paste the backup path from the backup command:

```bash
cd ops
npm run restore -- data/backups/PASTE-THE-FILE-NAME-HERE.sqlite
```

3. Run `npm start` again.
4. Open `http://127.0.0.1:8787`.

Expected result: the clients from that backup are back, including notes you had approved.

## What was tested

An automated check created a client, wrote a backup, changed the name in the live file, copied the backup back, and confirmed the original name returned. See `docs/TEST_RESULTS.md`.

## What a backup does not include

Redfin Partner Tools. If a note was only pasted into Redfin, it is not in this file. If a note was only saved here, it is not in Redfin until you paste it there.
