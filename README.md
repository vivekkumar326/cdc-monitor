# CDC Monitor

A real-time database change monitoring dashboard built with **React, Node.js, Express, MySQL, and Server-Sent Events (SSE)**. The application captures database changes through MySQL binary logs and displays them in a live dashboard with historical event analytics.

## Features

- Real-time `INSERT`, `UPDATE`, and `DELETE` event streaming
- MySQL binlog-based Change Data Capture (CDC)
- Student record CRUD operations through REST APIs
- Before-and-after values for update events
- Live event feed using Server-Sent Events
- Persistent CDC event history in MySQL
- Analytics summary for total events and operation counts
- Hourly activity chart for the previous 24 hours
- Student records table and connection status

## Tech Stack

- **Frontend:** React, Vite, Axios
- **Backend:** Node.js, Express
- **Database:** MySQL
- **CDC:** MySQL binary logs with `@powersync/mysql-zongji`
- **Real-time communication:** Server-Sent Events (SSE)
- **Configuration:** dotenv

## Architecture

```text
MySQL Database
      |
      | Binary Log Events
      v
CDC Reader (ZongJi)
      |
      v
Node.js + Express
      |
      +---- REST APIs
      |
      +---- Persistent Event History
      |
      +---- Server-Sent Events (SSE)
                    |
                    v
             React Dashboard
```

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/` | API status |
| GET | `/students` | List students |
| GET | `/students/:id` | Retrieve a student |
| POST | `/students` | Create a student |
| PUT | `/students/:id` | Update a student |
| DELETE | `/students/:id` | Delete a student |
| GET | `/events` | Subscribe to live CDC events using SSE |
| GET | `/events/history` | Retrieve stored event history |
| GET | `/analytics/summary` | Retrieve aggregate event and student counts |
| GET | `/analytics/activity` | Retrieve hourly activity for the previous 24 hours |

## Prerequisites

- Node.js and npm
- MySQL
- A MySQL database configured for binary logging
- Appropriate MySQL users and permissions for the application and CDC reader

## Run Locally

### 1. Clone the repository

```bash
git clone https://github.com/vivekkumar326/cdc-monitor.git
cd cdc-monitor
```

### 2. Install backend dependencies

```bash
npm install
```

### 3. Configure environment variables

Copy the example configuration:

```bash
cp .env.example .env
```

Edit `.env` with your local MySQL credentials. Do not commit `.env` or publish real database passwords.

The application uses these environment variables:

- `PORT` — backend port (default: `8001`)
- `APP_HOST` — backend bind address (default: `127.0.0.1`)
- `DB_HOST`, `DB_PORT`, `DB_NAME` — database connection settings
- `APP_DB_USER`, `APP_DB_PASSWORD` — application database credentials
- `CDC_DB_USER`, `CDC_DB_PASSWORD` — CDC reader credentials

Configure MySQL binary logging and grant the CDC user the permissions required by the CDC reader. Ensure the database and required tables exist before starting the application.

### 4. Start the backend

```bash
node server.js
```

By default, the API runs at `http://127.0.0.1:8001`.

### 5. Start the frontend

Open a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open the local URL printed by Vite, usually `http://localhost:5173`.

## Security

- Keep database credentials in `.env`.
- Never commit `.env`, passwords, or production secrets.
- Use a dedicated database user for the application and CDC reader.
- Restrict database and server access appropriately for your environment.

## Current Scope

This project demonstrates MySQL binary-log-based CDC, persistent event history, REST APIs, SSE event streaming, and a React analytics dashboard. The dashboard includes aggregate event counters and hourly activity over the previous 24 hours.

## Author

**Vivek Kumar**

GitHub: https://github.com/vivekkumar326

Project repository: https://github.com/vivekkumar326/cdc-monitor

