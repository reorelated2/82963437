# Backup and recovery

The desk database is the file `backend/data/os.sqlite` on the computer where the desk runs. Screenshots are in `backend/data/uploads`. Neither folder is in git.

## Make a backup from the page

1. Open the desk.
2. Tap **Settings**.
3. Tap **Back up this desk**.
4. Expected result: a green line with a file name like `os-2026-09-24T...sqlite`.
5. That file is in `backend/data/backups` on the same computer.
6. Copy that file somewhere else you trust, such as a drive you control. Do not email a backup that contains real clients.

## Make a backup by copying the file

1. Stop the desk (Control+C in the terminal).
2. Copy `backend/data/os.sqlite` to a folder outside the project.
3. Copy `backend/data/uploads` the same way if you need the screenshots.
4. Expected result: you have a second copy.

## Restore from the page

Restore replaces the current desk with the backup. Leads added after that backup are removed.

1. Settings is not the restore button, on purpose.
2. Use the API only if you mean it. From the `backend` folder, with the desk running:

```bash
curl -X POST http://127.0.0.1:8080/api/os/restore \
  -H 'Content-Type: application/json' \
  -d '{"file":"PASTE_THE_BACKUP_FILE_NAME","confirm":"RESTORE"}'
```

3. Expected result: `{"ok":true}`. Refresh the page. You should see the clients from that backup.

The automated check `a backup restores the earlier record` does this with a temporary database and passed on 2026-09-24.

## Export

Settings, then **Export records**, or open `http://127.0.0.1:8080/api/os/export`. You get a JSON file of contacts, facts, notes, drafts, tasks, and jobs. Demo rows are marked. This is a copy, not a live Redfin export.

## If the file is damaged

1. Stop the desk.
2. Rename `backend/data/os.sqlite` to `os.sqlite.broken`.
3. Copy a backup onto `backend/data/os.sqlite`.
4. Start the desk again.
5. Expected result: the backed up clients are back. Work done after that backup is not.
