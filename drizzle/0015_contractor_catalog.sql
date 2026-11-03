CREATE TABLE IF NOT EXISTS technician_contractors (
  technician_username TEXT PRIMARY KEY,
  contractor TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS contractors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  created_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO contractors (id, name, created_at)
SELECT lower(hex(randomblob(16))), trim(contractor), unixepoch() * 1000
FROM technician_contractors
WHERE trim(contractor) <> ''
GROUP BY lower(trim(contractor));
