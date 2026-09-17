"""Apply migrations in memory only. Never contacts Cloudflare."""
import json
import pathlib
import sqlite3

root = pathlib.Path(__file__).resolve().parents[1]
journal = json.loads((root / 'drizzle/meta/_journal.json').read_text())
db = sqlite3.connect(':memory:')
db.execute('PRAGMA foreign_keys = ON')
for entry in journal['entries']:
    db.executescript((root / 'drizzle' / (entry['tag'] + '.sql')).read_text())
assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
assert db.execute('PRAGMA foreign_key_check').fetchall() == []
assert db.execute("SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name LIKE 'onedrive_%'").fetchone()[0] == 3
print('All migrations applied successfully to an empty, in-memory database.')
