# EcoSort AI — Smart Waste Segregator

**EcoSort AI** tells you which dustbin your waste goes in. Upload a photo, scan it with your camera, or type or say the item's name, and you get:

1. **Waste category & type** (Organic Wet, PET #1 Plastic, E-Waste, Biomedical...)
2. **Which dustbin** to use (Green, Blue, Grey, Red, Orange), color coded
3. **Recyclability** (Recyclable / Compostable / Non-Recyclable / Hazardous) with preparation tips, decomposition time and an eco fact

It's a full-stack app: a **Node.js + Express backend** with a **SQLite database**, and a **web frontend** served by the same server.

---

## Features

| Area | What it does |
| :--- | :--- |
| 🔍 Search | Autocomplete as you type (arrow keys + Enter work), fuzzy matching, and a rule engine that still gives a good guess for items that aren't in the database |
| 📷 Photo & camera | Drag-and-drop or live camera. Photos are recognized **on your device** with TensorFlow.js MobileNet, or by **Google Gemini** on the server if you add an API key |
| 🎙️ Voice | Say the item name (Chrome / Edge). Results can be read aloud |
| 🗑️ Dustbin guide | All 5 bins explained, with the full list of items in each |
| 🎮 Quiz + leaderboard | 10-question rounds with streak bonuses. Scores are checked on the server and saved to a shared leaderboard |
| 🕘 History & stats | Each browser's scans are saved on the server (no sign-up needed), plus community stats for everyone using the same server |

---

## Quick start

**You need:** [Node.js](https://nodejs.org) **22.13 or newer** (the LTS download is fine). Check with `node --version`.

```bash
npm install
npm start
```

Then open **http://localhost:3000**.

That's it: no database to install. SQLite is built into Node, and the database file is created automatically at `data/ecosort.db`.

### Optional: smarter photo recognition with Gemini

1. Get a free API key at <https://aistudio.google.com/apikey>
2. Copy `.env.example` to `.env`
3. Put your key in it: `GEMINI_API_KEY=your-key-here`
4. Restart the server (`npm start`)

The key stays on the server and is never sent to the browser. If Gemini fails or isn't set up, the app automatically uses the on-device model instead.

---

## Sharing it with friends

### Option A: Same Wi-Fi (quickest)

When you run `npm start`, the terminal prints an address like:

```
On your Wi-Fi:      http://192.168.1.23:3000
```

Anyone on the same Wi-Fi can open that link on their phone or laptop. They'll share the same leaderboard and community stats.

> **Note:** browsers only allow the **camera** and **microphone** on `https://` sites or on `localhost`. Over a Wi-Fi `http://` link, photo upload, search and the quiz work fine, but live camera and voice won't. Deploy online (Option B) to get https.

If Windows asks whether to allow Node.js through the firewall, allow it on **private networks**.

### Option B: Put it online (free)

Any Node host works. For example, on [Render](https://render.com):

1. Push this folder to a GitHub repository
2. On Render: **New → Web Service**, then pick the repo
3. Settings:
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Environment variables (optional):** `GEMINI_API_KEY`
4. Deploy. You get an `https://...onrender.com` link to share, and camera and voice work there.

> Free hosting plans usually wipe the disk on every redeploy, so history and the leaderboard reset. Attach a persistent disk and set `DB_PATH` to a file on it if you want them to stick.

### Option C: Give them the code

Zip this folder **without** `node_modules`, `data/` and `.env` (your API key!). They run `npm install` and `npm start` themselves.

---

## Configuration

All settings are optional and go in `.env` (see `.env.example`):

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `PORT` | `3000` | Port the server listens on |
| `DB_PATH` | `./data/ecosort.db` | SQLite database file |
| `GEMINI_API_KEY` | *(empty)* | Turns on Gemini photo recognition |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Which Gemini model to use |

---

## Project structure

```
smart-waste-segregator/
├── package.json
├── .env.example              # copy to .env for settings
├── server/                   # ── BACKEND ──
│   ├── index.js              # starts the server (npm start)
│   ├── app.js                # Express app: /api + serves public/
│   ├── config.js             # reads .env / environment variables
│   ├── db.js                 # SQLite tables: scans, quiz_sessions, leaderboard
│   ├── routes/api.js         # all REST endpoints
│   ├── services/
│   │   ├── classifier.js     # search, fuzzy matching, rules, label → item mapping
│   │   ├── gemini.js         # optional Gemini photo recognition
│   │   └── quiz.js           # quiz rounds and scoring
│   └── data/wasteData.js     # knowledge base: 5 bins, 40 items, quiz questions
├── public/                   # ── FRONTEND ──
│   ├── index.html
│   ├── styles.css
│   └── js/
│       ├── api.js            # talks to the backend
│       ├── app.js            # main UI: search, photos, results, guide, history
│       ├── game.js           # quiz + leaderboard UI
│       ├── vision.js         # on-device MobileNet (loaded only when needed)
│       └── speech.js         # voice search, read-aloud, sound effects
├── tests/api.test.js         # API tests (npm test)
└── data/                     # SQLite database (created automatically)
```

### How a photo is recognized

```
Browser ──photo──▶ POST /api/classify/image ──▶ Gemini (if GEMINI_API_KEY is set)
   │                        └── fails / not set ──┐
   ▼                                              ▼
MobileNet runs in the browser ──labels──▶ POST /api/classify/labels ──▶ matching waste item
```

---

## REST API

All endpoints return JSON. History endpoints need an `X-Client-Id` header (the frontend creates a random one per browser).

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| GET | `/api/health` | Server status |
| GET | `/api/config` | Whether Gemini is enabled, quiz size |
| GET | `/api/bins` | The 5 dustbins with item counts |
| GET | `/api/bins/:binId/items` | All items for one bin |
| GET | `/api/items` · `/api/items/:id` | Knowledge base items |
| GET | `/api/search?q=soda can` | Best match for a name: `{ match: { item, confidence, matchType } }` |
| GET | `/api/suggest?q=bott` | Autocomplete suggestions |
| POST | `/api/classify/labels` | `{ predictions: [{ className, probability }] }` → matching items |
| POST | `/api/classify/image` | Multipart `image` file → Gemini result (max 5 MB, 15 per minute) |
| GET / POST / DELETE | `/api/history` | List, add or clear this browser's scans |
| GET | `/api/stats` | Scans per bin: yours and the community's |
| POST | `/api/quiz` | Start a 10-question round |
| POST | `/api/quiz/:id/answer` | `{ binId }` → result + next question |
| POST | `/api/quiz/:id/submit` | `{ name }` → save a finished round to the leaderboard |
| GET | `/api/leaderboard` | Top scores |

Example:

```bash
curl "http://localhost:3000/api/search?q=banana%20peel"
```

---

## Municipal dustbin color coding

| Dustbin | Category | What goes in | Status |
| :--- | :--- | :--- | :--- |
| 🟢 **Green** | Wet / Organic | Fruit & veg peels, leftover food, eggshells, coffee grounds, tea leaves, garden leaves | Compostable |
| 🔵 **Blue** | Dry Recyclable | PET bottles (#1), HDPE containers (#2), cardboard, newspaper, aluminum & tin cans, glass bottles | Recyclable |
| ⚫ **Grey / Black** | Dry Non-Recyclable | Chip packets, styrofoam, plastic straws, greasy pizza boxes, broken ceramics | Landfill |
| 🔴 **Red / Yellow** | Hazardous & Biomedical | Expired medicines, sanitary waste, syringes, CFL / tube lights, paints, pesticides | Special disposal |
| 🟠 **Orange / Purple** | E-Waste | Phones, chargers, cables, batteries, laptops, circuit boards | E-waste recycler |

---

## Development

```bash
npm run dev   # restarts the server automatically when you edit backend files
npm test      # runs the API tests
```

To add a new waste item, add an entry to `WASTE_ITEMS` in `server/data/wasteData.js` and restart. It shows up in search, the dustbin guide and the quiz automatically.

## Troubleshooting

- **`Cannot find module 'node:sqlite'` or a syntax error on start:** your Node.js is too old. Install 22.13 or newer.
- **"Can't reach the EcoSort server" banner:** the server isn't running. Run `npm start` again.
- **Port already in use:** set another port, for example `PORT=4000` in `.env`.
- **Camera / mic don't work:** use `http://localhost:3000` on the same computer, or an https deployment.
