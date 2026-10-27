
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");
const ZongJi = require("@powersync/mysql-zongji");

const app = express();

const PORT = Number(process.env.PORT || 8001);
const HOST = process.env.APP_HOST || "127.0.0.1";
const DATABASE = process.env.DB_NAME || "cdc_monitor";

// A unique replication client ID. Do not use MySQL's server_id here.
const CDC_SERVER_ID = 100;

app.use(cors());
app.use(express.json());

const clients = new Set();

let db;
let zongji;
let server;
let shuttingDown = false;

// --------------------------------------------------
// Database helpers
// --------------------------------------------------

function getStudentId(row) {
  if (!row) return null;
  return row.id ?? row.ID ?? null;
}

function normalizeRow(row) {
  if (!row) return null;

  return {
    id: row.id ?? row.ID,
    name: row.name ?? row.NAME,
    marks: row.marks ?? row.MARKS,
  };
}

// --------------------------------------------------
// Server-Sent Events (SSE)
// --------------------------------------------------

function publishChange(event) {
  const message = `data: ${JSON.stringify(event)}\n\n`;

  for (const client of clients) {
    try {
      client.write(message);
    } catch (error) {
      clients.delete(client);
    }
  }
}

// --------------------------------------------------
// Persistent event history
// --------------------------------------------------

async function persistChange(change) {
  const sql = `
    INSERT INTO cdc_event_history
      (operation, record_id, event_data)
    VALUES (?, ?, ?)
  `;

  await db.execute(sql, [
    change.operation,
    change.id,
    JSON.stringify(change),
  ]);
}

// --------------------------------------------------
// CDC: MySQL binary log reader
// --------------------------------------------------

function startCDC() {
  zongji = new ZongJi({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.CDC_DB_USER,
    password: process.env.CDC_DB_PASSWORD,
    database: DATABASE,
  });

  zongji.on("error", (error) => {
    console.error("CDC reader error:", error.message);
  });

  zongji.on("binlog", (event) => {
    void handleBinlogEvent(event).catch((error) => {
      console.error("CDC event processing error:", error.message);
    });
  });

  // IMPORTANT: serverId belongs in start() options.
  // It must be unique among replication clients.
  zongji.start({
    serverId: CDC_SERVER_ID,

    includeEvents: [
      "tablemap",
      "writerows",
      "updaterows",
      "deleterows",
    ],

    includeSchema: {
      [DATABASE]: ["students"],
    },
  });

  console.log(`CDC reader started with serverId ${CDC_SERVER_ID}.`);
}

async function handleBinlogEvent(event) {
  if (shuttingDown) return;

  const eventName = event.getEventName();

  const operations = {
    writerows: "INSERT",
    updaterows: "UPDATE",
    deleterows: "DELETE",
  };

  const operation = operations[eventName];

  // Ignore table-map events and other non-row events.
  if (!operation) return;

  const table = event.tableMap?.[event.tableId];

  if (!table) {
    console.warn("CDC: table metadata not found; skipping event.");
    return;
  }

  if (table.tableName !== "students") return;

  if (table.parentSchema && table.parentSchema !== DATABASE) return;

  const rows = event.rows || [];

  for (const rawRow of rows) {
    let row;

    if (operation === "UPDATE") {
      row = normalizeRow(rawRow.after);
    } else {
      row = normalizeRow(rawRow);
    }

    if (!row || row.id == null) {
      console.warn("CDC: student row has no ID; skipping event.");
      continue;
    }

    const change = {
      operation,
      id: row.id,
      name: row.name,
      marks: row.marks,
      data: row,
      time: new Date().toISOString(),
    };

    // Persist first, then broadcast. A persistence failure is logged,
    // but does not prevent the live dashboard from receiving the event.
    try {
      await persistChange(change);
    } catch (error) {
      console.error("Failed to save CDC event history:", error.message);
    }

    publishChange(change);

    console.log(`CDC event: ${operation} ${row.id}`);
  }
}

// --------------------------------------------------
// Health check
// --------------------------------------------------

app.get("/", (req, res) => {
  res.json({
    message: "CDC Monitor API is running",
    database: DATABASE,
    cdcServerId: CDC_SERVER_ID,
  });
});

// --------------------------------------------------
// Student CRUD APIs
// --------------------------------------------------

// Get all students
app.get("/students", async (req, res) => {
  try {
    const [rows] = await db.execute(
      "SELECT id, name, marks FROM students ORDER BY id DESC"
    );

    res.json(rows);
  } catch (error) {
    console.error("GET /students:", error.message);
    res.status(500).json({ error: "Failed to fetch students" });
  }
});

// Get one student
app.get("/students/:id", async (req, res) => {
  try {
    const [rows] = await db.execute(
      "SELECT id, name, marks FROM students WHERE id = ?",
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Student not found" });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error("GET /students/:id:", error.message);
    res.status(500).json({ error: "Failed to fetch student" });
  }
});

// Create a student
app.post("/students", async (req, res) => {
  try {
    const { name, marks } = req.body;

    if (
      typeof name !== "string" ||
      !name.trim() ||
      marks === undefined ||
      marks === null ||
      marks === "" ||
      !Number.isFinite(Number(marks))
    ) {
      return res.status(400).json({
        error: "A valid name and numeric marks are required",
      });
    }

    const numericMarks = Number(marks);

    if (numericMarks < 0 || numericMarks > 100) {
      return res.status(400).json({
        error: "Marks must be between 0 and 100",
      });
    }

    const [result] = await db.execute(
      "INSERT INTO students (name, marks) VALUES (?, ?)",
      [name.trim(), numericMarks]
    );

    res.status(201).json({
      message: "Student created",
      id: result.insertId,
      name: name.trim(),
      marks: numericMarks,
    });
  } catch (error) {
    console.error("POST /students:", error.message);
    res.status(500).json({ error: "Failed to create student" });
  }
});

// Update a student
app.put("/students/:id", async (req, res) => {
  try {
    const { name, marks } = req.body;

    if (
      typeof name !== "string" ||
      !name.trim() ||
      marks === undefined ||
      marks === null ||
      marks === "" ||
      !Number.isFinite(Number(marks))
    ) {
      return res.status(400).json({
        error: "A valid name and numeric marks are required",
      });
    }

    const numericMarks = Number(marks);

    if (numericMarks < 0 || numericMarks > 100) {
      return res.status(400).json({
        error: "Marks must be between 0 and 100",
      });
    }

    const [result] = await db.execute(
      "UPDATE students SET name = ?, marks = ? WHERE id = ?",
      [name.trim(), numericMarks, req.params.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Student not found" });
    }

    res.json({
      message: "Student updated",
      id: Number(req.params.id),
      name: name.trim(),
      marks: numericMarks,
    });
  } catch (error) {
    console.error("PUT /students/:id:", error.message);
    res.status(500).json({ error: "Failed to update student" });
  }
});

// Delete a student
app.delete("/students/:id", async (req, res) => {
  try {
    const [result] = await db.execute(
      "DELETE FROM students WHERE id = ?",
      [req.params.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Student not found" });
    }

    res.json({
      message: "Student deleted",
      id: Number(req.params.id),
    });
  } catch (error) {
    console.error("DELETE /students/:id:", error.message);
    res.status(500).json({ error: "Failed to delete student" });
  }
});

// --------------------------------------------------
// Backend-powered analytics
// --------------------------------------------------

// Complete historical counts, independent of the latest-50 history API
app.get("/analytics/summary", async (req, res) => {
  try {
    const [eventRows] = await db.execute(`
      SELECT
        COUNT(*) AS totalEvents,
        COALESCE(SUM(operation = 'INSERT'), 0) AS inserts,
        COALESCE(SUM(operation = 'UPDATE'), 0) AS updates,
        COALESCE(SUM(operation = 'DELETE'), 0) AS deletes
      FROM cdc_event_history
    `);

    const [studentRows] = await db.execute(`
      SELECT COUNT(*) AS totalStudents
      FROM students
    `);

    res.json({
      ...eventRows[0],
      totalStudents: studentRows[0].totalStudents,
    });
  } catch (error) {
    console.error("GET /analytics/summary:", error.message);
    res.status(500).json({ error: "Failed to fetch analytics summary" });
  }
});

// Hourly operation counts for the previous 24 hours
app.get("/analytics/activity", async (req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT
        DATE_FORMAT(event_time, '%Y-%m-%d %H:00:00') AS hour,
        SUM(operation = 'INSERT') AS inserts,
        SUM(operation = 'UPDATE') AS updates,
        SUM(operation = 'DELETE') AS deletes
      FROM cdc_event_history
      WHERE event_time >= NOW() - INTERVAL 24 HOUR
        AND event_time <= NOW()
      GROUP BY DATE_FORMAT(event_time, '%Y-%m-%d %H:00:00')
      ORDER BY hour ASC
    `);

    res.json(rows);
  } catch (error) {
    console.error("GET /analytics/activity:", error.message);
    res.status(500).json({ error: "Failed to fetch hourly activity" });
  }
});
// --------------------------------------------------
// Persistent event history API
// --------------------------------------------------

app.get("/events/history", async (req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT
        id AS history_id,
        operation,
        record_id,
        event_data,
        event_time
      FROM cdc_event_history
      ORDER BY id DESC
      LIMIT 50
    `);

    const history = rows.map((row) => {
      let savedEvent = row.event_data;

      // mysql2 may return a JSON column as an object or a string.
      if (typeof savedEvent === "string") {
        try {
          savedEvent = JSON.parse(savedEvent);
        } catch {
          savedEvent = {};
        }
      }

      return {
        ...(savedEvent || {}),
        operation: row.operation,
        id: row.record_id,
        time: row.event_time,
        historyId: row.history_id,
      };
    });

    res.json(history);
  } catch (error) {
    console.error("GET /events/history:", error.message);
    res.status(500).json({ error: "Failed to fetch event history" });
  }
});

// --------------------------------------------------
// Live SSE API
// --------------------------------------------------

app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  res.flushHeaders?.();

  // Tell EventSource that the connection is established.
  res.write("retry: 3000\n\n");

  clients.add(res);

  const heartbeat = setInterval(() => {
    if (!res.destroyed && !res.writableEnded) {
      res.write(": heartbeat\n\n");
    }
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
});

// --------------------------------------------------
// Startup and graceful shutdown
// --------------------------------------------------

async function startServer() {
  if (!process.env.APP_DB_USER || !process.env.APP_DB_PASSWORD) {
    throw new Error("APP_DB_USER and APP_DB_PASSWORD must be set in .env");
  }

  if (!process.env.CDC_DB_USER || !process.env.CDC_DB_PASSWORD) {
    throw new Error("CDC_DB_USER and CDC_DB_PASSWORD must be set in .env");
  }

  db = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.APP_DB_USER,
    password: process.env.APP_DB_PASSWORD,
    database: DATABASE,
  });

  console.log("Application database connected.");

  // Verify that history table exists and is accessible.
  await db.execute("SELECT 1 FROM cdc_event_history LIMIT 1");

  console.log("CDC event history table verified.");

  // Start listening before starting CDC.
  server = app.listen(PORT, HOST, () => {
    console.log(`Server running at http://${HOST}:${PORT}`);
  });

  try {
    startCDC();
  } catch (error) {
    console.error("Failed to start CDC reader:", error.message);
  }
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log("\nShutting down CDC Monitor...");

  if (zongji) {
    try {
      zongji.stop();
    } catch (error) {
      console.error("Error stopping CDC reader:", error.message);
    }
  }

  for (const client of clients) {
    try {
      client.end();
    } catch {
      // Ignore already-closed clients.
    }
  }

  clients.clear();

  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }

  if (db) {
    try {
      await db.end();
    } catch (error) {
      console.error("Error closing database:", error.message);
    }
  }

  console.log("Shutdown complete.");
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});

startServer().catch((error) => {
  console.error("Application startup failed:", error.message);
  process.exitCode = 1;
});
