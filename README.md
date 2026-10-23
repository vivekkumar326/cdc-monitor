# CDC Monitor

A real-time database change monitoring dashboard built using React, Node.js, Express, MySQL, and Server-Sent Events (SSE).

## Features

- Real-time INSERT, UPDATE, and DELETE event streaming
- Student record management through REST APIs
- Before-and-after values for update events
- Live React dashboard
- Student records table
- Event counters and connection status

## Tech Stack

- Frontend: React, Vite, Axios
- Backend: Node.js, Express
- Database: MySQL
- Real-time communication: Server-Sent Events (SSE)

## Architecture

MySQL → Node.js + Express → SSE → React Dashboard

## Run Locally

### Backend

Install dependencies:

    npm install

Start the backend:

    node server.js

The backend runs on port 8001.

### Frontend

Open a second terminal:

    cd frontend
    npm install
    npm run dev

Open the local URL displayed by Vite, usually http://localhost:5173.

## Current Scope

This version streams events for database operations performed through the Node.js API. Transaction-log-based CDC is a planned enhancement.

## Author

Vivek Kumar

GitHub: https://github.com/vivekkumar326
