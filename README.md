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
nano .env
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

## Start Mining

```bash
node longyu.js auto           
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




