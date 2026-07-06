import "dotenv/config";
import crypto from "crypto";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import nodemailer from "nodemailer";
import rateLimit from "express-rate-limit";
import pg from "pg";
import { z } from "zod";

const {
  DATABASE_URL,
  EMAIL_FROM,
  EMAIL_TO = "wolllfyx@gmail.com",
  SMTP_HOST,
  SMTP_PORT = "587",
  SMTP_USER,
  SMTP_PASS,
  ALLOWED_ORIGINS = "https://processrite.com,https://www.processrite.com,https://portal.processrite.com",
  IP_HASH_SECRET = "change-this-in-render",
  CRM_API_KEY = "",
  PORTAL_USERNAME = "wxsdom",
  PORTAL_PASSWORD = "Beitanan",
  AUTH_SECRET = IP_HASH_SECRET,
  AUTH_SESSION_TTL_SECONDS = "28800"
} = process.env;

const app = express();
app.set("trust proxy", 1);

const pool = DATABASE_URL
  ? new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null;

const alwaysAllowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "http://localhost:5176",
  "http://localhost:5177",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
  "http://127.0.0.1:5175",
  "http://127.0.0.1:5176",
  "http://127.0.0.1:5177",
  "https://portal.processrite.com"
];

const allowedOrigins = Array.from(new Set([
  ...ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean),
  ...alwaysAllowedOrigins
]));

app.use(helmet());
app.use(express.json({ limit: "64kb" }));
app.use(express.urlencoded({ extended: false, limit: "64kb" }));
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin not allowed"));
  }
}));

const leadSubmitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false
});

const crmReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 240,
  standardHeaders: true,
  legacyHeaders: false
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false
});

const loginSchema = z.object({
  username: z.string().trim().min(1).max(120),
  password: z.string().min(1).max(240)
});

const leadSchema = z.object({
  name: z.string().trim().min(2).max(120),
  business_name: z.string().trim().max(160).optional().default(""),
  phone: z.string().trim().min(7).max(40),
  email: z.string().trim().email().max(160),
  business_type: z.string().trim().min(2).max(120),
  monthly_processing_volume: z.string().trim().min(1).max(120),
  current_processor: z.string().trim().max(160).optional().default(""),
  message: z.string().trim().max(3000).optional().default(""),
  page_source: z.string().trim().url().max(500).optional().default("https://processrite.com/"),
  timestamp: z.string().trim().max(80).optional(),
  company: z.string().trim().max(1).optional().default("")
});

const leadUpdateSchema = z.object({
  status: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(5000).optional(),
  assigned_to: z.string().trim().max(160).optional(),
  follow_up_date: z.string().trim().max(80).optional(),
  lead_score: z.string().trim().max(80).optional(),
  archived: z.boolean().optional()
});

function requireEnv() {
  const missing = [];
  for (const key of ["DATABASE_URL", "EMAIL_FROM", "EMAIL_TO", "SMTP_HOST", "SMTP_USER", "SMTP_PASS"]) {
    if (!process.env[key]) missing.push(key);
  }
  if (process.env.SMTP_PASS === "REPLACE_WITH_GMAIL_APP_PASSWORD") missing.push("SMTP_PASS");
  return missing;
}

function requireDatabase(res) {
  if (!pool) {
    res.status(500).json({ ok: false, message: "Database is not configured." });
    return false;
  }
  return true;
}

function safeEqual(a = "", b = "") {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function signTokenPayload(payload) {
  return crypto.createHmac("sha256", AUTH_SECRET).update(payload).digest("base64url");
}

function createAuthToken(username) {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + Number(AUTH_SESSION_TTL_SECONDS || 28800);
  const payload = Buffer.from(JSON.stringify({
    sub: username,
    iat: now,
    exp: expiresAt,
    scope: "crm"
  })).toString("base64url");
  const signature = signTokenPayload(payload);
  return { token: `${payload}.${signature}`, expiresAt };
}

function verifyAuthToken(token = "") {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  const expected = signTokenPayload(payload);
  if (!safeEqual(signature, expected)) return false;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (data.scope !== "crm") return false;
    if (!data.exp || Date.now() >= Number(data.exp) * 1000) return false;
    return true;
  } catch {
    return false;
  }
}

function requireCrmAccess(req, res) {
  const provided = req.get("x-crm-api-key") || "";
  if (CRM_API_KEY && safeEqual(provided, CRM_API_KEY)) return true;

  const authorization = req.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (verifyAuthToken(token)) return true;

  res.status(401).json({ ok: false, message: "Unauthorized." });
  return false;
}

function hashIp(rawIp = "") {
  return crypto.createHmac("sha256", IP_HASH_SECRET).update(rawIp).digest("hex");
}

function leadEmailText(lead, createdAt) {
  return [
    "New Process Rite lead submission",
    "",
    `Submitted: ${createdAt}`,
    `Page source: ${lead.page_source}`,
    "",
    `Name: ${lead.name}`,
    `Business name: ${lead.business_name || "Not provided"}`,
    `Phone: ${lead.phone}`,
    `Email: ${lead.email}`,
    `Business type: ${lead.business_type}`,
    `Monthly processing volume: ${lead.monthly_processing_volume}`,
    `Current processor: ${lead.current_processor || "Not provided"}`,
    "",
    "Message:",
    lead.message || "Not provided"
  ].join("\n");
}

function getMailer() {
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    family: 4,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000
  });
}

function normalizeLead(row) {
  return {
    id: row.id,
    created_at: row.created_at,
    name: row.name || "",
    business_name: row.business_name || "",
    phone: row.phone || "",
    email: row.email || "",
    business_type: row.business_type || "",
    monthly_processing_volume: row.monthly_processing_volume || "",
    current_processor: row.current_processor || "",
    message: row.message || "",
    page_source: row.page_source || "",
    email_alert_sent: Boolean(row.email_alert_sent),
    status: row.status || "New",
    notes: row.notes || "",
    assigned_to: row.assigned_to || "",
    follow_up_date: row.follow_up_date || "",
    lead_score: row.lead_score || "",
    archived: Boolean(row.archived)
  };
}

async function ensureSchema() {
  if (!pool) return;
  await pool.query(`
    create table if not exists lead_submissions (
      id bigserial primary key,
      created_at timestamptz not null default now(),
      name text not null,
      business_name text,
      phone text not null,
      email text not null,
      business_type text not null,
      monthly_processing_volume text not null,
      current_processor text,
      message text,
      page_source text,
      user_agent text,
      ip_hash text,
      email_alert_sent boolean not null default false
    );

    alter table lead_submissions add column if not exists status text default 'New';
    alter table lead_submissions add column if not exists notes text default '';
    alter table lead_submissions add column if not exists assigned_to text default '';
    alter table lead_submissions add column if not exists follow_up_date text default '';
    alter table lead_submissions add column if not exists lead_score text default '';
    alter table lead_submissions add column if not exists archived boolean not null default false;

    create index if not exists lead_submissions_created_at_idx on lead_submissions (created_at desc);
    create index if not exists lead_submissions_email_idx on lead_submissions (lower(email));
    create index if not exists lead_submissions_status_idx on lead_submissions (status);
    create index if not exists lead_submissions_archived_idx on lead_submissions (archived);
  `);
}

app.get("/health", (_req, res) => {
  const missing = requireEnv();
  if (missing.length) return res.status(500).json({ ok: false, missing });
  return res.status(200).json({ ok: true });
});

app.post("/api/auth/login", authLimiter, (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, message: "Username and password are required." });

  const { username, password } = parsed.data;
  if (!safeEqual(username, PORTAL_USERNAME) || !safeEqual(password, PORTAL_PASSWORD)) {
    return res.status(401).json({ ok: false, message: "Invalid credentials." });
  }

  const session = createAuthToken(username);
  return res.status(200).json({
    ok: true,
    token: session.token,
    expires_at: session.expiresAt
  });
});

app.get("/api/leads", crmReadLimiter, async (req, res) => {
  if (!requireCrmAccess(req, res)) return;
  if (!requireDatabase(res)) return;

  const limitRaw = Number(req.query.limit || 500);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 1000) : 500;
  const search = String(req.query.search || "").trim();
  const status = String(req.query.status || "").trim();
  const includeArchived = String(req.query.include_archived || "false") === "true";

  const params = [];
  const where = [];

  if (!includeArchived) where.push("coalesce(archived, false) = false");

  if (status && status !== "All") {
    params.push(status);
    where.push(`coalesce(status, 'New') = $${params.length}`);
  }

  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    where.push(`(
      lower(coalesce(name, '')) like $${params.length}
      or lower(coalesce(business_name, '')) like $${params.length}
      or lower(coalesce(phone, '')) like $${params.length}
      or lower(coalesce(email, '')) like $${params.length}
      or lower(coalesce(business_type, '')) like $${params.length}
      or lower(coalesce(current_processor, '')) like $${params.length}
      or lower(coalesce(page_source, '')) like $${params.length}
    )`);
  }

  params.push(limit);

  try {
    const result = await pool.query(
      `
      select
        id,
        created_at,
        name,
        business_name,
        phone,
        email,
        business_type,
        monthly_processing_volume,
        current_processor,
        message,
        page_source,
        email_alert_sent,
        coalesce(status, 'New') as status,
        coalesce(notes, '') as notes,
        coalesce(assigned_to, '') as assigned_to,
        coalesce(follow_up_date, '') as follow_up_date,
        coalesce(lead_score, '') as lead_score,
        coalesce(archived, false) as archived
      from lead_submissions
      ${where.length ? `where ${where.join(" and ")}` : ""}
      order by created_at desc
      limit $${params.length}
      `,
      params
    );

    return res.status(200).json({
      ok: true,
      count: result.rows.length,
      leads: result.rows.map(normalizeLead)
    });
  } catch (error) {
    console.error("lead_list_error", { code: error.code || error.name, message: error.message });
    return res.status(500).json({ ok: false, message: "Unable to load leads.", code: error.code || error.name || "UNKNOWN" });
  }
});

app.get("/api/leads/stats", crmReadLimiter, async (req, res) => {
  if (!requireCrmAccess(req, res)) return;
  if (!requireDatabase(res)) return;

  try {
    const result = await pool.query(`
      select
        count(*)::int as total,
        count(*) filter (where created_at >= date_trunc('day', now()))::int as today,
        count(*) filter (where created_at >= date_trunc('month', now()))::int as this_month,
        count(*) filter (where coalesce(status, 'New') = 'New')::int as new_leads,
        count(*) filter (where coalesce(status, '') = 'Contacted')::int as contacted,
        count(*) filter (where coalesce(status, '') = 'Follow Up')::int as follow_up,
        count(*) filter (where coalesce(status, '') = 'Statement Received')::int as statement_received,
        count(*) filter (where coalesce(status, '') = 'Pricing Sent')::int as pricing_sent,
        count(*) filter (where coalesce(status, '') = 'Won')::int as won,
        count(*) filter (where coalesce(status, '') = 'Lost')::int as lost
      from lead_submissions
      where coalesce(archived, false) = false
    `);

    return res.status(200).json({ ok: true, stats: result.rows[0] });
  } catch (error) {
    console.error("lead_stats_error", { code: error.code || error.name, message: error.message });
    return res.status(500).json({ ok: false, message: "Unable to load lead stats.", code: error.code || error.name || "UNKNOWN" });
  }
});

app.get("/api/leads/:id", crmReadLimiter, async (req, res) => {
  if (!requireCrmAccess(req, res)) return;
  if (!requireDatabase(res)) return;

  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, message: "Invalid lead id." });

  try {
    const result = await pool.query(
      `
      select
        id,
        created_at,
        name,
        business_name,
        phone,
        email,
        business_type,
        monthly_processing_volume,
        current_processor,
        message,
        page_source,
        email_alert_sent,
        coalesce(status, 'New') as status,
        coalesce(notes, '') as notes,
        coalesce(assigned_to, '') as assigned_to,
        coalesce(follow_up_date, '') as follow_up_date,
        coalesce(lead_score, '') as lead_score,
        coalesce(archived, false) as archived
      from lead_submissions
      where id = $1
      `,
      [id]
    );

    if (!result.rows[0]) return res.status(404).json({ ok: false, message: "Lead not found." });
    return res.status(200).json({ ok: true, lead: normalizeLead(result.rows[0]) });
  } catch (error) {
    console.error("lead_detail_error", { code: error.code || error.name, message: error.message });
    return res.status(500).json({ ok: false, message: "Unable to load lead.", code: error.code || error.name || "UNKNOWN" });
  }
});

app.patch("/api/leads/:id", crmReadLimiter, async (req, res) => {
  if (!requireCrmAccess(req, res)) return;
  if (!requireDatabase(res)) return;

  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, message: "Invalid lead id." });

  const parsed = leadUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, message: "Invalid update fields." });

  const fields = [];
  const values = [];

  for (const [key, value] of Object.entries(parsed.data)) {
    values.push(value);
    fields.push(`${key} = $${values.length}`);
  }

  if (!fields.length) return res.status(400).json({ ok: false, message: "No fields to update." });

  values.push(id);

  try {
    const result = await pool.query(
      `
      update lead_submissions
      set ${fields.join(", ")}
      where id = $${values.length}
      returning
        id,
        created_at,
        name,
        business_name,
        phone,
        email,
        business_type,
        monthly_processing_volume,
        current_processor,
        message,
        page_source,
        email_alert_sent,
        coalesce(status, 'New') as status,
        coalesce(notes, '') as notes,
        coalesce(assigned_to, '') as assigned_to,
        coalesce(follow_up_date, '') as follow_up_date,
        coalesce(lead_score, '') as lead_score,
        coalesce(archived, false) as archived
      `,
      values
    );

    if (!result.rows[0]) return res.status(404).json({ ok: false, message: "Lead not found." });
    return res.status(200).json({ ok: true, lead: normalizeLead(result.rows[0]) });
  } catch (error) {
    console.error("lead_update_error", { code: error.code || error.name, message: error.message });
    return res.status(500).json({ ok: false, message: "Unable to update lead.", code: error.code || error.name || "UNKNOWN" });
  }
});

app.post("/api/leads", leadSubmitLimiter, async (req, res) => {
  const missing = requireEnv();
  if (missing.length) return res.status(500).json({ ok: false, message: "Lead service is not fully configured." });
  if (!requireDatabase(res)) return;

  console.info("lead_request_received", { pageSource: req.body?.page_source || "", hasEmail: Boolean(req.body?.email) });

  const parsed = leadSchema.safeParse(req.body);
  if (!parsed.success) {
    console.warn("lead_validation_failed", { issues: parsed.error.issues.map((issue) => issue.path.join(".")) });
    return res.status(400).json({ ok: false, message: "Please check the form fields and try again." });
  }

  const lead = parsed.data;
  if (lead.company) return res.status(200).json({ ok: true });

  const createdAt = new Date().toISOString();
  const clientIp = req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() || req.ip || "";
  const ipHash = hashIp(clientIp);
  const userAgent = (req.get("user-agent") || "").slice(0, 500);
  let submissionId = null;
  let emailSent = false;

  const client = await pool.connect();
  try {
    const stored = await client.query(
      `insert into lead_submissions
       (name, business_name, phone, email, business_type, monthly_processing_volume, current_processor, message, page_source, user_agent, ip_hash, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       returning id`,
      [
        lead.name,
        lead.business_name,
        lead.phone,
        lead.email,
        lead.business_type,
        lead.monthly_processing_volume,
        lead.current_processor,
        lead.message,
        lead.page_source,
        userAgent,
        ipHash,
        "New"
      ]
    );
    submissionId = stored.rows[0].id;

    console.info("lead_submission_stored", { id: submissionId, pageSource: lead.page_source });

    await getMailer().sendMail({
      from: EMAIL_FROM,
      to: EMAIL_TO,
      replyTo: lead.email,
      subject: `New Process Rite lead: ${lead.name}${lead.business_name ? ` at ${lead.business_name}` : ""}`,
      text: leadEmailText(lead, createdAt)
    });
    emailSent = true;

    await client.query("update lead_submissions set email_alert_sent = true where id = $1", [submissionId]);
    console.info("lead_submission", { id: submissionId, emailSent, pageSource: lead.page_source });
    return res.status(201).json({ ok: true, message: "Thanks. Your message was sent.", id: submissionId });
  } catch (error) {
    console.error("lead_submission_error", {
      id: submissionId,
      emailSent,
      code: error.code || error.name,
      message: error.message
    });
    return res.status(500).json({
      ok: false,
      message: "Something went wrong. Please call or email Process Rite directly.",
      code: error.code || error.name || "UNKNOWN",
      detail: String(error.message || "").slice(0, 160)
    });
  } finally {
    client.release();
  }
});

const port = process.env.PORT || 3000;
ensureSchema()
  .then(() => {
    app.listen(port, () => console.log(`Process Rite lead backend listening on ${port}`));
  })
  .catch((error) => {
    console.error("schema_init_error", { code: error.code || error.name, message: error.message });
    process.exit(1);
  });
