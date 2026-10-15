# BIG THREE — Shared Server + Turso Database

Colorful contribution tracker for **Teresia**, **Brayan**, and **Mary**.

All members see the **same live data** from any device.  
Data is stored permanently in a free **Turso** cloud database.

## Default passwords

| Member  | Role   | Password        |
|---------|--------|-----------------|
| TERESIA | Admin  | `teresia-admin` |
| BRAYAN  | Member | `brayan123`     |
| MARY    | Member | `mary123`       |

**Change the passwords after first login.**

---

## Deploy on Render (recommended)

1. Create a free account at https://render.com
2. Push this folder to a GitHub repository
3. On Render → **New +** → **Web Service**
4. Connect the GitHub repo
5. Settings:

| Field            | Value              |
|------------------|--------------------|
| Name             | big-three          |
| Runtime          | Node               |
| Build Command    | `npm install`      |
| Start Command    | `node server.js`   |
| Instance Type    | Free               |

6. Go to **Environment** and add these two variables (recommended):

| Key                    | Value                                      |
|------------------------|--------------------------------------------|
| `TURSO_DATABASE_URL`   | `libsql://big-three-mbogo123.aws-us-east-1.turso.io` |
| `TURSO_AUTH_TOKEN`     | *(your Turso auth token)*                  |

(If you skip the environment variables, the credentials already inside the code will still work.)

7. Click **Create Web Service**

After 1–2 minutes you will get a public URL like:  
`https://big-three-xxxx.onrender.com`

Share that link with everyone. They can also **Add to Home Screen**.

---

## Run locally (for testing)

```bash
npm install
node server.js
```

Then open http://localhost:3000

---

## Notes

- Data is permanent (stored in Turso)
- Auto-refreshes every 12 seconds
- Free Render service may sleep after inactivity — first visit after sleep can take 20–40 seconds
- Keep your Turso token private

Enjoy the shared BIG THREE circle! 🟣🩷🧡

