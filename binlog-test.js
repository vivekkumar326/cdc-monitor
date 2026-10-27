require("dotenv").config();

const ZongJi = require("@powersync/mysql-zongji");

const zongji = new ZongJi({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.CDC_DB_USER,
  password: process.env.CDC_DB_PASSWORD,
  database: process.env.DB_NAME,
});

zongji.on("error", (error) => {
  console.error("CDC reader error:", error.message);
});

zongji.on("ready", () => {
  console.log("CDC reader connected to MySQL binlog.");
  console.log("Now waiting for INSERT, UPDATE and DELETE events...");
});

zongji.on("binlog", (event) => {
  const type = event.getEventName();

  if (["writerows", "updaterows", "deleterows"].includes(type)) {
    console.log("\n--- BINLOG ROW EVENT ---");
    console.log("Event type:", type);
    console.log("Table metadata:", event.tableMap);
    console.dir(event.rows, { depth: 5 });
  }
});

zongji.start({
  serverId: 100,
  startAtEnd: true,
  includeSchema: {
    cdc_monitor: ["students"],
  },
  includeEvents: [
    "tablemap",
    "writerows",
    "updaterows",
    "deleterows",
    "rotate",
  ],
});

process.on("SIGINT", () => {
  console.log("\nStopping CDC reader...");
  zongji.stop();
  process.exit(0);
});

