# Backup and recovery

Two local databases exist. They are not interchangeable.

## KyleOS desk (`ops/data/desk.sqlite`)

The desk keeps one file: `ops/data/desk.sqlite`. Copying that file is the backup. Do this while the desk is stopped so the copy is clean. The command below also works while it is stopped.

### Make a backup

1. Open Terminal in the project folder.
2. Paste:

```bash
cd ops
npm run backup
```

Expected result: a line that starts with `Backup written to` and ends in `ops/data/backups/kleinman-desk-....sqlite`.

While the desk is running you can also download a copy from `http://127.0.0.1:8787/api/backup`. Save that file somewhere outside the project. Restore still happens in Terminal, with the desk stopped.

### Restore

1. Stop the desk. In the Terminal window that says it is running, press Control+C.
2. Paste the backup path from the backup command:

```bash
cd ops
npm run restore -- data/backups/PASTE-THE-FILE-NAME-HERE.sqlite
```

3. Run `npm start` again.
4. Open `http://127.0.0.1:8787`.

Expected result: the clients from that backup are back, including notes you had approved.

### What was tested

An automated check created a client, wrote a backup, changed the name in the live file, copied the backup back, and confirmed the original name returned. See `docs/TEST_RESULTS.md`.

### What a backup does not include

Redfin Partner Tools. If a note was only pasted into Redfin, it is not in this file. If a note was only saved here, it is not in Redfin until you paste it there.

## Consult app experiment (`backend/data/os.sqlite`)

This file belongs to the unmounted `backend/src/os` experiment. The Buyer Command Center server does not mount that desk. Do not restore this file over `ops/data/desk.sqlite`.

Screenshots for that experiment are in `backend/data/uploads`. Neither folder is in git.

### Make a backup from that page

1. Open that desk only if you intentionally started it.
2. Tap **Settings**.
3. Tap **Back up this desk**.
4. Expected result: a green line with a file name like `os-2026-09-24T...sqlite`.
5. That file is in `backend/data/backups` on the same computer.
6. Copy that file somewhere else you trust, such as a drive you control. Do not email a backup that contains real clients.

### Make a backup by copying the file

1. Stop the process (Control+C in the terminal).
2. Copy `backend/data/os.sqlite` to a folder outside the project.
3. Copy `backend/data/uploads` the same way if you need the screenshots.
4. Expected result: you have a second copy.

### Restore from that page

Restore replaces the current experiment file with the backup. Leads added after that backup are removed.

1. Settings is not the restore button, on purpose.
2. From the `backend` folder, with that process running:

```bash
curl -X POST http://127.0.0.1:8080/api/os/restore \
  -H 'Content-Type: application/json' \
  -d '{"file":"PASTE_THE_BACKUP_FILE_NAME","confirm":"RESTORE"}'
```

That route exists only when the experiment is mounted. The Buyer Command Center does not mount it. Expected result when it is mounted: `{"ok":true}`.

The automated check `a backup restores the earlier record` does this with a temporary database and passed on 2026-09-24. See the consult-app section of `docs/TEST_RESULTS.md`.

### Export

Settings, then **Export records**, or open `http://127.0.0.1:8080/api/os/export` when that desk is mounted. You get a JSON file of contacts, facts, notes, drafts, tasks, and jobs. Demo rows are marked. This is a copy, not a live Redfin export.

### If the experiment file is damaged

1. Stop the process.
2. Rename `backend/data/os.sqlite` to `os.sqlite.broken`.
3. Copy a backup onto `backend/data/os.sqlite`.
4. Start the process again.
5. Expected result: the backed up clients are back. Work done after that backup is not.
