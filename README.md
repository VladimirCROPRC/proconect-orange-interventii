# Proconect Orange Intervenții

Aplicație internă separată pentru administrarea și documentarea intervențiilor Orange.

## Funcționalități

- Management tichete FITT, IMO și PBM, cu SLA, județ și echipă alocată.
- Flux complet de constatare, execuție, materiale, fotografii și documentare.
- Hărți OpenStreetMap, localizarea avariei și punctele activităților.
- Generare QAF, rapoarte și fișe de materiale.
- Centralizator Excel în Google Drive, actualizat automat în tabelul `Table1` din foaia `Tichete corective Orange`.
- Acces separat pentru administratori, coordonatori și tehnicieni.
- Izolare la nivel de API, bază de date și teste automate: sunt acceptate exclusiv intervențiile Orange FITT, IMO și PBM.
- Registrul de hartă inclus pornește gol; importați numai date aprobate pentru rețeaua Orange.

## Publicare în Cloudflare

1. Creează baza D1 `proconect-orange-interventii-db`.
2. Creează bucket-ul R2 `proconect-orange-interventii-files`.
3. Înlocuiește `YOUR_ORANGE_D1_DATABASE_ID` din `wrangler.jsonc` cu identificatorul bazei.
4. Configurează secretele `PROCONECT_ADMIN_PASSWORD`, `PROCONECT_TECHNICIAN_PASSWORD` și `PROCONECT_DRIVE_ENCRYPTION_KEY` exclusiv în Cloudflare.
5. Conectează repository-ul prin Cloudflare Workers & Pages → Create application → Import a repository.
6. Comanda de build: `npm run build`.
7. Comanda de deploy: `npx wrangler d1 migrations apply proconect-orange-interventii-db --remote && npx wrangler deploy --config wrangler.jsonc`.
8. Configurează aplicația Microsoft Entra și conectează OneDrive din Administrare, conform `docs/ONEDRIVE_SETUP.md`.
9. Conectează Google Drive din Administrare. Aplicația creează și înlocuiește automat `Centralizator ENO3 Y4.xlsx` în folderul `Interventii Orange`; OneDrive nu este necesar pentru această funcție.

Nu adăuga parole, tokenuri, fotografii ale clienților sau exporturi ale bazei de date în repository.
