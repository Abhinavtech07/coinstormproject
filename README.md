
# CoinStorm (Demo)

This package contains a small demo of the CoinStorm app:
- Node.js + Express backend (SQLite)
- Frontend in `/public` with ad placements loaded from `config.json`
- Admin UI at `/admin.html` (password-protected using the configured admin password)

## Quick start (local)

1. Install dependencies:
```bash
cd coinstorm_project
npm install
```

2. Initialize DB:
```bash
node server.js --initdb
```

3. Start server:
```bash
node server.js
```

Open your browser at http://localhost:3001/

- Admin page: http://localhost:3001/admin.html
  - Default admin password: Cs!Adm1n#2025
  - After logging in, you can create/retrieve redeem codes.

## Notes and next steps
- **Change the admin password** in `config.json` immediately after deployment.
- Redeem codes created from admin UI are stored in `redemptions` table with session_id 'ADMIN'.
- For production: enable HTTPS, move DB to managed DB, add proper auth for admin, and integrate ad-network server callbacks for stronger verification.
