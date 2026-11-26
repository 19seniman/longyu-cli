# longyu.js — CLI LONGYU MINE (mine.longyu.network)

Login pakai **bearer token** dari browser (situs hanya menyediakan login X/Twitter OAuth), lalu
jalankan sesi mining lengkap: attest device, proof-of-work, verifikasi output root L2, sampai klaim reward.

```
┌──────────────────────────────────────────────┐
│  L O N G Y U   M I N E   companion           │
│  project  Longyu · mine.longyu.network       │
│  author   19Seniman                          │
│  build    v1.0.0                             │
└──────────────────────────────────────────────┘
```

## Instalasi

```bash
git clone https://github.com/19seniman/longyu-cli.git
cd longyu-cli
npm install
cp .env.example .env
```

## Ambil token

1. Buka `https://mine.longyu.network`, login dengan **X (Twitter)**
2. **F12** → *Application* → *Local Storage* → `https://mine.longyu.network`
3. Cari key **`longyu.tokens`**, isinya `{"accessToken":"…","refreshToken":"…"}`
4. Isi `.env`:

```ini
ACCESS_TOKEN=eyJ…
REFRESH_TOKEN=…
```

Token disegarkan otomatis lewat `/v1/auth/refresh` dan disimpan ke `.tokens.json` (mode 600).

## Cek koneksi

```bash
node longyu.js debug
```

Harapan: tiga baris hijau — `API publik OK`, `chain check OK … match`, `auth OK`.

## Mining

```bash
node longyu.js attest          # wajib sekali per device
node longyu.js mine            # satu sesi (PoW + verifikasi chain)
node longyu.js mine --follow   # ikut heartbeat sampai sesi habis
node longyu.js auto            # loop: mulai sesi, check, klaim
```

Alur yang dijalankan, sama seperti web-nya:

1. `POST /v1/mining/challenge` → `challengeId`, `nonce`, `work.bits`
2. **PoW**: cari `counter` sehingga `sha256("nonce:counter")` punya ≥ `bits` bit nol
3. **Chain check**: baca `latestOutputIndex()` + `getL2Output()` dari OutputOracle di BSC,
   ambil `stateRoot`/`blockHash` blok L2 dan `storageHash` MessagePasser (`0x4200…0016`),
   lalu `keccak256(0x00×32 ‖ stateRoot ‖ messagePasserRoot ‖ blockHash)` dibandingkan dengan output root
4. `POST /v1/mining/start` dengan `challengeId`, `work`, `captchaToken`
5. Selama sesi: `POST /v1/mining/check {index, parts}` tiap `CHAIN_CHECK_MS`

Kalau server minta human check, muncul `[HUMAN_CHECK]`. Selesaikan Turnstile di browser lalu:

```bash
node longyu.js mine --turnstile <token>
```

## Reward

```bash
node longyu.js claim
node longyu.js rewards
node longyu.js activity
```

## Data & sosial

```bash
node longyu.js status        # sesi, rate, power, claimable
node longyu.js me
node longyu.js network
node longyu.js tasks [--reply]
node longyu.js invites
node longyu.js boosts
node longyu.js leaderboard
node longyu.js stats
node longyu.js check         # kirim bukti state L2 sekali
```

## Perintah lengkap

| Perintah | Keterangan |
|---|---|
| `token` | cek bearer token + cara ambilnya |
| `me` | profil akun |
| `status` | status mining |
| `network` | info chain & token reward |
| `attest` | attest device |
| `mine [--follow]` | mulai sesi mining |
| `check` | kirim bukti state L2 |
| `claim` | klaim reward |
| `rewards` / `activity` | riwayat |
| `tasks [--reply]` | daftar task X |
| `invites` / `boosts` / `leaderboard` / `stats` | data lain |
| `auto` | loop otomatis |
| `debug` | tes API + chain + token |

Semua perintah menerima `--quiet` untuk mematikan banner.

## Endpoint yang dipetakan

Diambil dari bundle `__common` aplikasi web (Expo/Metro), bukan tebakan.

| Grup | Endpoint |
|---|---|
| Auth | `POST /v1/auth/x/start`, `/v1/auth/x/finish`, `/v1/auth/refresh`, `/v1/auth/logout` |
| Akun | `GET /v1/me`, `GET /v1/network` |
| Mining | `GET /v1/mining/status`, `POST /v1/mining/challenge`, `/v1/mining/start`, `/v1/mining/check` |
| Device | `POST /v1/device/challenge`, `/v1/device/attest` |
| Reward | `GET /v1/rewards`, `POST /v1/rewards/claim` |
| Sosial | `GET /v1/tasks?with=reply`, `/v1/invites`, `/v1/leaderboard`, `/v1/stats`, `/v1/activity` |
| Boost & wallet | `GET /v1/boosts`, `/v1/boosts/orders`, `POST /v1/wallet/challenge`, `/v1/wallet/link` |
| Lain | `POST /v1/verification/session`, `GET /v1/appeals`, push web subscribe |

## Catatan

- Login **tidak bisa** lewat private key: situs memakai X OAuth untuk akun, wallet hanya bisa di-*link*
  setelah masuk (`/v1/wallet/link` butuh sesi aktif).
- Human check Cloudflare Turnstile tidak bisa diselesaikan dari Node — kirim tokennya manual.
- Script hanya membaca data dan menjalankan sesi mining/klaim; tidak ada transfer dana.
- `stats` hari ini: 13.528 miner, `verificationOpen: false` (verifikasi identitas belum dibuka).
