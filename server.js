const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");
const { createClient } = require("@libsql/client");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

// Turso credentials — prefer environment variables (recommended on Render)
const TURSO_URL = process.env.TURSO_DATABASE_URL || "libsql://big-three-mbogo123.aws-us-east-1.turso.io";
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN || "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3OTE5ODU0MjgsImlkIjoiMDFhMTNhYTUtMGMwMS03MjQzLWExZTQtMDAyMDkyZjRjY2EyIiwia2lkIjoieWZaZnkyRUtPenNyUlF4RFBZMnhiNnJGRk15UkFPZ2FCQXR0X2p0dkFyMCIsInJpZCI6ImVkOTA5YTI1LTQyMTYtNGFlMy04MTk5LTU2YWFiMjAxZWExNCJ9.jQprHUtF3aMNdJONPyS0Z1xMlasw76bUj5Ir9zgTpfagWumW5SoqTPGCCuQwt5qNN5Tb5CHUClwSEynmNp86AQ";

const MEMBERS = ["TERESIA", "BRAYAN", "MARY"];
const DEFAULT_USERS = [
  { name: "TERESIA", password: "teresia-admin", role: "admin" },
  { name: "BRAYAN",  password: "brayan123",     role: "member" },
  { name: "MARY",    password: "mary123",       role: "member" }
];

// token -> { user, role, expires }
const sessions = new Map();
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const db = createClient({
  url: TURSO_URL,
  authToken: TURSO_TOKEN
});

async function initDB() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      name TEXT PRIMARY KEY,
      password TEXT NOT NULL,
      role TEXT NOT NULL
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS contributions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member TEXT NOT NULL,
      amount REAL NOT NULL,
      date TEXT NOT NULL,
      notes TEXT DEFAULT ''
    )
  `);

  // Seed default users if table is empty
  const existing = await db.execute("SELECT COUNT(*) as c FROM users");
  if (Number(existing.rows[0].c) === 0) {
    for (const u of DEFAULT_USERS) {
      await db.execute({
        sql: "INSERT INTO users (name, password, role) VALUES (?, ?, ?)",
        args: [u.name, u.password, u.role]
      });
    }
    console.log("Seeded default users.");
  }
}

async function getUser(name) {
  const r = await db.execute({
    sql: "SELECT name, password, role FROM users WHERE name = ?",
    args: [name]
  });
  return r.rows[0] || null;
}

async function getPublicData() {
  const usersRes = await db.execute("SELECT name, role FROM users");
  const users = {};
  for (const row of usersRes.rows) {
    users[row.name] = { role: row.role };
  }

  const contribRes = await db.execute(
    "SELECT id, member, amount, date, notes FROM contributions ORDER BY date DESC, id DESC"
  );
  const contributions = contribRes.rows.map((r) => ({
    id: Number(r.id),
    member: r.member,
    amount: Number(r.amount),
    date: r.date,
    notes: r.notes || ""
  }));

  return { users, contributions };
}

function createToken() {
  return crypto.randomBytes(24).toString("hex");
}

function getSession(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() > s.expires) {
    sessions.delete(token);
    return null;
  }
  s.expires = Date.now() + SESSION_TTL_MS;
  return s;
}

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        req.destroy();
        reject(new Error("body too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".css": "text/css",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};

function serveStatic(req, res, pathname) {
  let filePath = path.join(PUBLIC_DIR, pathname === "/" ? "index.html" : pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (pathname !== "/index.html") {
        return serveStatic(req, res, "/index.html");
      }
      res.writeHead(404);
      return res.end("Not found");
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=86400"
    });
    res.end(data);
  });
}

async function handleAPI(req, res, pathname) {
  const method = req.method;

  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS"
    });
    return res.end();
  }

  // POST /api/login
  if (pathname === "/api/login" && method === "POST") {
    const body = await readBody(req);
    const user = (body.user || "").toString().toUpperCase().trim();
    const pass = (body.password || "").toString();
    const u = await getUser(user);
    if (!u || u.password !== pass) {
      return sendJSON(res, 401, { error: "Wrong password. Please try again." });
    }
    const token = createToken();
    sessions.set(token, {
      user: u.name,
      role: u.role,
      expires: Date.now() + SESSION_TTL_MS
    });
    return sendJSON(res, 200, {
      success: true,
      token,
      user: u.name,
      role: u.role
    });
  }

  // POST /api/logout
  if (pathname === "/api/logout" && method === "POST") {
    const session = getSession(req);
    if (session) {
      const auth = req.headers.authorization || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
      if (token) sessions.delete(token);
    }
    return sendJSON(res, 200, { success: true });
  }

  // GET /api/health
  if (pathname === "/api/health" && method === "GET") {
    return sendJSON(res, 200, { ok: true, members: MEMBERS, db: "turso" });
  }

  // Auth required below
  const session = getSession(req);
  if (!session) {
    return sendJSON(res, 401, { error: "Not authenticated. Please log in again." });
  }

  // GET /api/data
  if (pathname === "/api/data" && method === "GET") {
    const data = await getPublicData();
    return sendJSON(res, 200, data);
  }

  // POST /api/contributions
  if (pathname === "/api/contributions" && method === "POST") {
    if (session.role !== "admin") {
      return sendJSON(res, 403, { error: "Admin only." });
    }
    const body = await readBody(req);
    if (!body.member || !MEMBERS.includes(body.member)) {
      return sendJSON(res, 400, { error: "Invalid member" });
    }
    const amount = Number(body.amount) || 10000;
    const date = body.date || new Date().toISOString().slice(0, 10);
    const notes = (body.notes || "").toString();

    const result = await db.execute({
      sql: "INSERT INTO contributions (member, amount, date, notes) VALUES (?, ?, ?, ?)",
      args: [body.member, amount, date, notes]
    });

    const data = await getPublicData();
    return sendJSON(res, 200, {
      success: true,
      entry: {
        id: Number(result.lastInsertRowid),
        member: body.member,
        amount,
        date,
        notes
      },
      data
    });
  }

  // PUT / DELETE /api/contributions/:id
  const idMatch = pathname.match(/^\/api\/contributions\/(\d+)$/);
  if (idMatch) {
    if (session.role !== "admin") {
      return sendJSON(res, 403, { error: "Admin only." });
    }
    const id = Number(idMatch[1]);

    if (method === "PUT") {
      const body = await readBody(req);
      const existing = await db.execute({
        sql: "SELECT id FROM contributions WHERE id = ?",
        args: [id]
      });
      if (existing.rows.length === 0) {
        return sendJSON(res, 404, { error: "Not found" });
      }

      const member = body.member && MEMBERS.includes(body.member) ? body.member : null;
      const amount = body.amount !== undefined ? Number(body.amount) : null;
      const date = body.date || null;
      const notes = body.notes !== undefined ? (body.notes || "").toString() : null;

      // Build dynamic update
      const sets = [];
      const args = [];
      if (member) { sets.push("member = ?"); args.push(member); }
      if (amount !== null) { sets.push("amount = ?"); args.push(amount); }
      if (date) { sets.push("date = ?"); args.push(date); }
      if (notes !== null) { sets.push("notes = ?"); args.push(notes); }

      if (sets.length) {
        args.push(id);
        await db.execute({
          sql: `UPDATE contributions SET ${sets.join(", ")} WHERE id = ?`,
          args
        });
      }

      const data = await getPublicData();
      return sendJSON(res, 200, { success: true, data });
    }

    if (method === "DELETE") {
      const result = await db.execute({
        sql: "DELETE FROM contributions WHERE id = ?",
        args: [id]
      });
      if (result.rowsAffected === 0) {
        return sendJSON(res, 404, { error: "Not found" });
      }
      const data = await getPublicData();
      return sendJSON(res, 200, { success: true, data });
    }
  }

  // POST /api/change-password
  if (pathname === "/api/change-password" && method === "POST") {
    const body = await readBody(req);
    if (!body.newPassword || body.newPassword.length < 6) {
      return sendJSON(res, 400, {
        error: "New password must be at least 6 characters."
      });
    }
    const u = await getUser(session.user);
    if (!u || u.password !== body.current) {
      return sendJSON(res, 401, { error: "Current password is incorrect." });
    }
    await db.execute({
      sql: "UPDATE users SET password = ? WHERE name = ?",
      args: [body.newPassword, session.user]
    });
    return sendJSON(res, 200, { success: true });
  }

  sendJSON(res, 404, { error: "Not found" });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    if (pathname.startsWith("/api")) {
      await handleAPI(req, res, pathname);
      return;
    }

    serveStatic(req, res, pathname);
  } catch (e) {
    console.error(e);
    sendJSON(res, 500, { error: "Server error: " + (e.message || "unknown") });
  }
});

// Start
initDB()
  .then(() => {
    server.listen(PORT, () => {
      console.log("");
      console.log("  BIG THREE (Turso) server is running!");
      console.log("  → Local:   http://localhost:" + PORT);
      console.log("  → Database: Turso (permanent)");
      console.log("");
    });
  })
  .catch((err) => {
    console.error("Failed to initialize database:", err);
    process.exit(1);
  });
