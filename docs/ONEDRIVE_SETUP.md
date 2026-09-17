# OneDrive Microsoft 365 — activation after review

This branch does not deploy, change the production database, or connect a Microsoft account.
Google Drive remains the default. The existing Cloudflare database and R2 bucket remain primary storage.

## Microsoft registration

Use the company's single-tenant app registration. This restriction applies to the administrator's Microsoft connection, not technician logins.

1. Web redirect URI: `https://proconect-orange-interventii.vladimir-carlan.workers.dev/api/onedrive/callback`.
2. Microsoft Graph **delegated** permission: `Files.ReadWrite`, plus `offline_access` for background renewal. Do not add application permissions or `Sites.ReadWrite.All`.
3. Keep implicit grants disabled. Authorization uses the server-side code flow, PKCE and a single-use state bound to the current Proconect administrator session.
4. If company policy requires administrator consent, stop and wait for IT. Registration access does not guarantee consent.
5. Create a client secret only when ready to configure the Cloudflare Worker. Copy its **Value**, not Secret ID, directly into a Cloudflare secret. Never paste it into chat, GitHub, screenshots or frontend source. Record the expiry securely and rotate before expiry.

`Files.ReadWrite` permits access to the connected user's files, not just the application's folder. The implementation writes only to the `Proconect Orange Interventii` folder and uses no delete API. Review this scope with IT. The connected account must be allowed by company policy to store these documents.

## Cloudflare configuration (production, only after approval)

Worker → Settings → Variables and Secrets:

| Name | Type | Value |
| --- | --- | --- |
| `PROCONECT_APP_URL` | variable | `https://proconect-orange-interventii.vladimir-carlan.workers.dev` |
| `ONEDRIVE_CLIENT_ID` | variable | Application (client) ID from Entra |
| `ONEDRIVE_TENANT_ID` | variable | Directory (tenant) ID from Entra |
| `ONEDRIVE_CLIENT_SECRET` | secret | The new Microsoft secret value |
| `ONEDRIVE_ENCRYPTION_KEY` | secret | A new random 32-byte key encoded as 64 hexadecimal characters |
| `ORANGE_TICKETS_WORKBOOK_URL` | secret | Linkul SharePoint al registrului „Centralizator ENO3 Y4.xlsx” |

Generate the encryption key on a trusted machine using `openssl rand -hex 32`, then paste it directly into the secret field. Keep an encrypted recovery copy. Do not replace the existing Google Drive encryption key. Changing the OneDrive encryption key requires disconnecting/reconnecting OneDrive; it is not a token migration.

## Rollout order

1. Review and merge the PR only when deployment is approved. GitHub Actions performs tests and a build only; it contains no Cloudflare token or deployment command. Separately check Cloudflare Git integration branch/preview settings before enabling any deployment.
2. Back up the production D1 database through your existing procedure.
3. Apply the migrations using the normal D1 workflow before enabling the secrets: `npx wrangler d1 migrations apply proconect-orange-interventii-db --remote`. Review pending migrations before confirming. This command is an operator action, not run by CI.
4. Deploy the reviewed application build, then configure the variables and secrets above.
5. Sign in to Proconect as **Admin** → **Drive și OneDrive** → **Conectează Microsoft 365**.
6. Sign in to Microsoft yourself. Only the administrator does this; technicians continue to use their existing app accounts.
7. After connection, the destination remains **Google Drive**. Explicitly select **OneDrive** or **Google Drive + OneDrive** to enable OneDrive copies and enqueue the archive.
8. Click **Sincronizează / reîncearcă** and keep that page open while the initial archive is copied. Review the error list.

## What is copied

- User-uploaded files are organized as `Proconect Orange Interventii / Interventii Orange / ticket ID`. Ticket folder names stay readable; stable identifiers remain in filenames to prevent collisions.
- Uploaded photos and documents retain their extension and include their section and stable file identifier in the name. Reprocessing overwrites the same application-owned item, not another upload with the same original name.
- `Date_lucrare.json` contains the project, field documentation (including grounding declarations), administrative report, and file metadata/GPS. This is a structured export, not a newly rendered/signed PDF.
- Existing uploaded signed documents are copied as files. The integration does not inspect/OCR or alter their signed contents.
- Google Drive keeps its existing layout. Each provider has independent state; one failed provider does not skip the other.

This is **not a complete disaster-recovery backup**: user accounts, sessions, global settings and a tested full-database restore are not included. File deletion does not propagate to the cloud archives. Manage retention and access separately under company policy.

## Processing and retry behavior

The queue is durable in D1. Each worker invocation processes at most one item, with a two-minute lease to prevent parallel drains and revision checks to preserve newer edits. Microsoft calls have bounded timeouts. Transient failures persist a sanitized error and backoff (including Retry-After).

New successful POST/PATCH/DELETE operations can trigger one background job. The administrator's sync screen processes continuously, one request at a time, while open. **No periodic Cloudflare trigger is enabled by this patch.** If the application is idle and the screen is closed, pending retries wait for the next activity or manual sync. A worker shutdown leaves jobs pending; the lease expires so they can be retried. No paid queue service is introduced.

Existing Google retry behavior is unchanged. OneDrive statistics count only user-uploaded photographs and documents. "Synced" is the last confirmed copy, not a continuous check that nobody later deleted it in OneDrive. Remote deletion of an archive requires re-enqueuing/reconnecting for full resync; do not treat the destination as immutable storage.

Disconnect deletes only local OneDrive credentials, OAuth states and queue tracking, restores the default Google destination, and retains remote archives. An already in-flight upload may finish. Revoke application consent in Microsoft separately when required. Changing the connected Microsoft drive is rejected until explicit disconnect.

## Verification before relying on it

- Verify technicians and managers cannot use `/api/onedrive` and existing app login remains unchanged.
- Test Google-only, OneDrive-only and both with a test project and two photos having the same name.
- Confirm an uploaded signed grounding exception document and its structured declaration are present.
- Change field documentation and administrative report; check the updated JSON export.
- Check backoff after a temporary Microsoft failure and a successful retry.
- Reconnect after token expiry/revocation and check secret rotation.
- Check mobile access to the settings and unchanged technician uploads.

CI uses synthetic Microsoft responses, a temporary in-memory SQLite database and fake file storage. No live customer data, tokens or external writes are used in tests. Real tenant consent, OneDrive upload and Cloudflare runtime behavior must still be verified after activation.

Storage quota, Microsoft licensing and Cloudflare usage limits still apply; this integration does not guarantee unlimited zero-cost usage.

## References

- https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
- https://learn.microsoft.com/en-us/graph/permissions-reference
- https://learn.microsoft.com/en-us/graph/api/driveitem-put-content
- https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-user-consent


## Registrul Excel Online pentru tichetele Orange

Când este configurată variabila secretă `ORANGE_TICKETS_WORKBOOK_URL`, generarea unui proiect de tip
`Intervenție Orange` adaugă un rând în tabelul `Table1` din foaia „Tichete corective Orange”.
Sincronizarea verifică mai întâi coloana „Ticket ID”, astfel încât reîncercările să nu creeze duplicate.
Contul Microsoft 365 conectat în aplicație trebuie să aibă drept de editare asupra registrului partajat.
Coloana „Localitate” primește localitatea de plecare, „Judet” primește județul introdus în formular,
iar coloana „Volumetrie” rămâne necompletată.
