# Running Live vs Sandbox locally

Two Supabase projects: production and a sandbox branch (`vxrvsnwwjeukprkxfixf`). Backend
and frontend each have separate env files per environment so the two never share a
database connection — see `backend/.env` / `backend/.env.sandbox` and
`frontend/.env.local` / `frontend/.env.sandbox.local`.

## Backend

**Live (production):**
```powershell
cd backend
venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

**Sandbox:**
```powershell
cd backend
$env:ENV_FILE = ".env.sandbox"
venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8001
```

`$env:ENV_FILE` only lasts for that terminal session — set it again if you close and
reopen the sandbox terminal.

## Frontend

**Live (production):**
```powershell
cd frontend
npm run dev
```

**Sandbox:**
```powershell
cd frontend
npm run dev:sandbox
```

## Notes

- Run backend + frontend as a matched pair: live backend (8000) with `npm run dev`,
  sandbox backend (8001) with `npm run dev:sandbox`. Mixing them works too if you want
  that combo, but the default pairing is what each npm script's baked-in `VITE_API_URL`
  expects.
- All four (both backends + both frontends) can run at once in separate terminals —
  different ports, different `.env` files, no cross-talk.
- The deployed live site's frontend bundle calls the backend over LAN
  (`http://192.168.4.38:8000` baked in at build time) — that traffic always hits
  whichever process is running on port 8000, so keep port 8000 on `backend/.env`
  (production) whenever the live site might be in use.
