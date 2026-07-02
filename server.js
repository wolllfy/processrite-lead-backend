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
  ALLOWED_ORIGINS = "https://processrite.com,https://www.processrite.com",
  IP_HASH_SECRET = "change-this-in-render"
} = process.env;

const app = express();
const pool = DATABASE_URL
  ? new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null;

const allowedOrigins = ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean);

app.use(helmet());
app.use(express.json({ limit: "64kb" }));
app.use(express.urlencoded({ extended: false, limit: "64kb" }));
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin not allowed"));
  }
}));
app.use("/api/leads", rateLimit({ windowMs: 15 * 60 * 1000, limit: 8 }));

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

function requireEnv() {
  const missing = [];
  for (const key of ["DATABASE_URL", "EMAIL_FROM", "EMAIL_TO", "SMTP_HOST", "SMTP_USER", "SMTP_PASS"]) {
    if (!process.env[key]) missing.push(key);
  }
  return missing;
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
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
}

app.get("/health", (_req, res) => {
  const missing = requireEnv();
  res.status(missing.length ? 500 : 200).json({ ok: missing.length === 0, missing });
});

app.post("/api/leads", async (req, res) => {
  const missing = requireEnv();
  if (missing.length) return res.status(500).json({ ok: false, message: "Lead service is not fully configured." });

  const parsed = leadSchema.safeParse(req.body);
  if (!parsed.success) {
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
       (name, business_name, phone, email, business_type, monthly_processing_volume, current_processor, message, page_source, user_agent, ip_hash)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
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
        ipHash
      ]
    );
    submissionId = stored.rows[0].id;

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
    return res.status(201).json({ ok: true, message: "Thanks. Your message was sent." });
  } catch (error) {
    console.error("lead_submission_error", {
      id: submissionId,
      emailSent,
      code: error.code || error.name,
      message: error.message
    });
    return res.status(500).json({ ok: false, message: "Something went wrong. Please call or email Process Rite directly." });
  } finally {
    client.release();
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Process Rite lead backend listening on ${port}`));
