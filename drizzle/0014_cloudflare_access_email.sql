ALTER TABLE app_users ADD COLUMN email TEXT NOT NULL DEFAULT '';

UPDATE app_users
SET email = CASE
  WHEN username = 'vladimir.carlan' THEN 'vladimir.carlan@proconect.ro'
  ELSE username || '@proconect.ro'
END
WHERE email = '';

CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_idx
ON app_users(email)
WHERE email <> '';
