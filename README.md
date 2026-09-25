# Expedice — vyjmenovaná slova (v0.1, Island B)

Static offline PWA, vanilla JS, no build step. See the build brief in the parent folder.

- Local test: `python3 -m http.server` in this folder, open http://localhost:8000
- After changing any shipped file: `python3 tools/precache.py` (bumps the service-worker cache)
- Validate content: `python3 docs/validate.py content/b.json`
- New island content: give `docs/content-brief.md` + word list to a model → `content/<letter>.json`

Status: v0.1 Island B complete (assets, swipe game, rewards, duel, parent log + CSV). Waiting at CHECKPOINT C (phone test).
Fonts: Lexend, SIL Open Font License (assets/fonts/OFL-Lexend.txt).
