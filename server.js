
const express = require("express");
const mysql = require("mysql2/promise");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const clients = new Set();

async function startServer() {
  const db = await mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "vivek123", // Apna MySQL password yahan do
    database: "cdc_monitor",
  });

  console.log("MySQL connected");

  // Browser ko live events bhejne ke liye
  app.get("/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    clients.add(res);

    req.on("close", () => {
      clients.delete(res);
    });
  });

  function publishChange(event) {
    const message = `data: ${JSON.stringify(event)}\n\n`;

    for (const client of clients) {
      client.write(message);
    }
  }

  // Student add karo
  app.post("/students", async (req, res) => {
    try {
      const { name, marks } = req.body;

      if (
        typeof name !== "string" ||
        !name.trim() ||
        !Number.isInteger(marks) ||
        marks < 0 ||
        marks > 100
      ) {
        return res.status(400).json({
          error: "Valid name and marks (0-100) required",
        });
      }

      const [result] = await db.execute(
        "INSERT INTO students (name, marks) VALUES (?, ?)",
        [name.trim(), marks]
      );

      const event = {
        operation: "INSERT",
        id: result.insertId,
        name: name.trim(),
        marks,
        time: new Date().toISOString(),
      };

      publishChange(event);

      res.status(201).json({
        message: "Student created",
        event,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Database operation failed" });
    }
  });

  // Student ke marks update karo
  app.put("/students/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { marks } = req.body;

      if (
        !Number.isSafeInteger(id) ||
        id <= 0 ||
        !Number.isInteger(marks) ||
        marks < 0 ||
        marks > 100
      ) {
        return res.status(400).json({
          error: "Valid student ID and marks required",
        });
      }

      const [rows] = await db.execute(
        "SELECT id, name, marks FROM students WHERE id = ?",
        [id]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: "Student not found" });
      }

      const before = rows[0];

      await db.execute(
        "UPDATE students SET marks = ? WHERE id = ?",
        [marks, id]
      );

      publishChange({
        operation: "UPDATE",
        id,
        before,
        after: { ...before, marks },
        time: new Date().toISOString(),
      });

      res.json({ message: "Student updated" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Database operation failed" });
    }
  });

  // Student delete karo
  app.delete("/students/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);

      if (!Number.isSafeInteger(id) || id <= 0) {
        return res.status(400).json({ error: "Invalid student ID" });
      }

      const [rows] = await db.execute(
        "SELECT id, name, marks FROM students WHERE id = ?",
        [id]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: "Student not found" });
      }

      await db.execute(
        "DELETE FROM students WHERE id = ?",
        [id]
      );

      publishChange({
        operation: "DELETE",
        before: rows[0],
        time: new Date().toISOString(),
      });

      res.json({ message: "Student deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Database operation failed" });
    }
  });

  // Current student records dekho
  app.get("/students", async (req, res) => {
    try {
      const [rows] = await db.execute(
        "SELECT * FROM students ORDER BY id"
      );

      res.json(rows);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Database operation failed" });
    }
  });

 app.listen(8001, "127.0.0.1", () => {
  console.log("Server running at http://127.0.0.1:8001");
});
}

startServer().catch(console.error);
