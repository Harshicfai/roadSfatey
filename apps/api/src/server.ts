import cors from "cors";
import dotenv from "dotenv";
import express, { NextFunction, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { createServer } from "http";
import { Pool } from "pg";
import { Server as SocketIOServer } from "socket.io";
import { z } from "zod";

dotenv.config();

const PORT = Number(process.env.PORT ?? 4000);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "http://localhost:3000";
const DEFAULT_USER_ID = process.env.DEFAULT_USER_ID ?? "demo-user";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Please configure apps/api/.env");
}

const pool = new Pool({ connectionString: databaseUrl });

const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: CORS_ORIGIN,
    methods: ["GET", "POST", "PUT", "DELETE"],
  },
});

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

const appLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again shortly." },
});

app.use(appLimiter);

const contactSchema = z.object({
  userId: z.string().min(1).optional(),
  name: z.string().min(1),
  phone: z.string().min(5),
  relationship: z.string().optional(),
});

const incidentSchema = z.object({
  userId: z.string().min(1).optional(),
  incidentType: z.string().min(1).default("report"),
  description: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

const sosSchema = z.object({
  userId: z.string().min(1).optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  description: z.string().default("SOS alert triggered"),
});

const locationSchema = z.object({
  userId: z.string().min(1).optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().positive().optional(),
});

const nearbyResponderSchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  radiusKm: z.coerce.number().positive().default(8),
});

type ResponderRecord = {
  id: number;
  name: string;
  responderType: "ambulance" | "police" | "volunteer";
  latitude: number;
  longitude: number;
  phone: string | null;
};

const haversineDistanceKm = (
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
) => {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const latDelta = toRad(latitudeB - latitudeA);
  const lonDelta = toRad(longitudeB - longitudeA);
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(toRad(latitudeA)) *
      Math.cos(toRad(latitudeB)) *
      Math.sin(lonDelta / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const ensureUser = async (userId: string) => {
  await pool.query(
    "INSERT INTO users (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
    [userId, userId === DEFAULT_USER_ID ? "Demo User" : "Road Safety User"],
  );
};

app.get("/health", async (_req, res, next) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  } catch (error) {
    next(error);
  }
});

app.get("/api/contacts", async (req, res, next) => {
  try {
    const userId = String(req.query.userId ?? DEFAULT_USER_ID);
    const { rows } = await pool.query(
      "SELECT id, user_id AS \"userId\", name, phone, relationship, created_at AS \"createdAt\" FROM contacts WHERE user_id = $1 ORDER BY id DESC",
      [userId],
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

app.post("/api/contacts", async (req, res, next) => {
  try {
    const payload = contactSchema.parse(req.body);
    const userId = payload.userId ?? DEFAULT_USER_ID;
    await ensureUser(userId);

    const { rows } = await pool.query(
      "INSERT INTO contacts (user_id, name, phone, relationship) VALUES ($1, $2, $3, $4) RETURNING id, user_id AS \"userId\", name, phone, relationship, created_at AS \"createdAt\"",
      [userId, payload.name, payload.phone, payload.relationship ?? null],
    );

    res.status(201).json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.put("/api/contacts/:id", async (req, res, next) => {
  try {
    const contactId = Number(req.params.id);
    if (!Number.isInteger(contactId) || contactId <= 0) {
      res.status(400).json({ error: "Invalid contact id" });
      return;
    }

    const payload = contactSchema.parse(req.body);
    const userId = payload.userId ?? DEFAULT_USER_ID;
    await ensureUser(userId);

    const { rows } = await pool.query(
      "UPDATE contacts SET name = $1, phone = $2, relationship = $3, updated_at = NOW() WHERE id = $4 AND user_id = $5 RETURNING id, user_id AS \"userId\", name, phone, relationship, created_at AS \"createdAt\"",
      [payload.name, payload.phone, payload.relationship ?? null, contactId, userId],
    );

    if (!rows[0]) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }

    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/contacts/:id", async (req, res, next) => {
  try {
    const contactId = Number(req.params.id);
    const userId = String(req.query.userId ?? DEFAULT_USER_ID);

    if (!Number.isInteger(contactId) || contactId <= 0) {
      res.status(400).json({ error: "Invalid contact id" });
      return;
    }

    const { rowCount } = await pool.query(
      "DELETE FROM contacts WHERE id = $1 AND user_id = $2",
      [contactId, userId],
    );

    if (!rowCount) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.get("/api/incidents", async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 20), 50);
    const { rows } = await pool.query(
      "SELECT id, user_id AS \"userId\", incident_type AS \"incidentType\", description, latitude, longitude, created_at AS \"createdAt\" FROM incidents ORDER BY created_at DESC LIMIT $1",
      [Number.isNaN(limit) ? 20 : limit],
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

app.post("/api/incidents", async (req, res, next) => {
  try {
    const payload = incidentSchema.parse(req.body);
    const userId = payload.userId ?? DEFAULT_USER_ID;
    await ensureUser(userId);

    const { rows } = await pool.query(
      "INSERT INTO incidents (user_id, incident_type, description, latitude, longitude) VALUES ($1, $2, $3, $4, $5) RETURNING id, user_id AS \"userId\", incident_type AS \"incidentType\", description, latitude, longitude, created_at AS \"createdAt\"",
      [
        userId,
        payload.incidentType.toLowerCase(),
        payload.description,
        payload.latitude,
        payload.longitude,
      ],
    );

    io.emit("incident:created", rows[0]);
    res.status(201).json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.post("/api/sos", async (req, res, next) => {
  try {
    const payload = sosSchema.parse(req.body);
    const userId = payload.userId ?? DEFAULT_USER_ID;
    await ensureUser(userId);

    const { rows } = await pool.query(
      "INSERT INTO incidents (user_id, incident_type, description, latitude, longitude) VALUES ($1, 'sos', $2, $3, $4) RETURNING id, user_id AS \"userId\", incident_type AS \"incidentType\", description, latitude, longitude, created_at AS \"createdAt\"",
      [userId, payload.description, payload.latitude, payload.longitude],
    );

    io.emit("incident:created", rows[0]);
    res.status(201).json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.post("/api/location-updates", async (req, res, next) => {
  try {
    const payload = locationSchema.parse(req.body);
    const userId = payload.userId ?? DEFAULT_USER_ID;
    await ensureUser(userId);

    const { rows } = await pool.query(
      "INSERT INTO location_updates (user_id, latitude, longitude, accuracy) VALUES ($1, $2, $3, $4) RETURNING id, user_id AS \"userId\", latitude, longitude, accuracy, created_at AS \"createdAt\"",
      [userId, payload.latitude, payload.longitude, payload.accuracy ?? null],
    );

    io.emit("location:updated", rows[0]);
    res.status(201).json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.get("/api/responders/nearby", async (req, res, next) => {
  try {
    const query = nearbyResponderSchema.parse(req.query);
    const { rows } = await pool.query<ResponderRecord>(
      "SELECT id, name, responder_type AS \"responderType\", latitude, longitude, phone FROM responders",
    );

    const nearby = rows
      .map((responder) => {
        const distanceKm = haversineDistanceKm(
          query.latitude,
          query.longitude,
          responder.latitude,
          responder.longitude,
        );

        return {
          ...responder,
          distanceKm: Number(distanceKm.toFixed(2)),
        };
      })
      .filter((responder) => responder.distanceKm <= query.radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);

    res.json(nearby);
  } catch (error) {
    next(error);
  }
});

io.on("connection", (socket) => {
  socket.emit("system:connected", { ok: true, timestamp: new Date().toISOString() });
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: "Validation failed", details: error.flatten() });
    return;
  }

  const message = error instanceof Error ? error.message : "Unexpected error";
  res.status(500).json({ error: message });
});

httpServer.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
});
