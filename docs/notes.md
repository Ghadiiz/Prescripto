# Notes

Short per-increment notes, newest at the bottom.

## 0.1 — Verify the Commands section of CLAUDE.md

Checked every command against `package.json` and `docker-compose.yml`: there is
no root `package.json`, so npm commands run inside `backend/`, `frontend/` or
`admin/`, and backend watch mode is `npm run server` (nodemon), not `npm run
dev`. Also added a root `.env.example` covering the eight variables Compose
interpolates, and logged the listen-before-`connectDB` startup race as 0.7.
