
import { useEffect, useState } from "react";
import axios from "axios";
import "./App.css";

const API = "http://127.0.0.1:8001";

function App() {
  const [students, setStudents] = useState([]);
  const [events, setEvents] = useState([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    axios
      .get(`${API}/students`)
      .then((response) => setStudents(response.data))
      .catch((error) => console.error("Student fetch failed:", error));

    const source = new EventSource(`${API}/events`);

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);

    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data);

        setEvents((previous) => [event, ...previous].slice(0, 50));

        if (event.operation === "INSERT") {
          setStudents((previous) => [
            ...previous.filter((student) => student.id !== event.id),
            {
              id: event.id,
              name: event.name,
              marks: event.marks,
            },
          ]);
        }

        if (event.operation === "UPDATE" && event.after) {
          setStudents((previous) =>
            previous.map((student) =>
              student.id === event.after.id
                ? event.after
                : student
            )
          );
        }

        if (event.operation === "DELETE" && event.before) {
          setStudents((previous) =>
            previous.filter(
              (student) => student.id !== event.before.id
            )
          );
        }
      } catch (error) {
        console.error("Invalid event:", error);
      }
    };

    return () => source.close();
  }, []);

  const counts = {
    INSERT: events.filter((event) => event.operation === "INSERT").length,
    UPDATE: events.filter((event) => event.operation === "UPDATE").length,
    DELETE: events.filter((event) => event.operation === "DELETE").length,
  };

  return (
    <main className="dashboard">
      <header className="topbar">
        <div>
          <p className="eyebrow">DATABASE OBSERVABILITY</p>
          <h1>Live CDC Monitor</h1>
          <p className="subtitle">
            Monitor student database changes in real time.
          </p>
        </div>

        <div className={`connection ${connected ? "online" : "offline"}`}>
          <span className="dot" />
          {connected ? "Stream Connected" : "Connecting..."}
        </div>
      </header>

      <section className="stats">
        <article className="stat-card">
          <span>Total Students</span>
          <strong>{students.length}</strong>
        </article>
        <article className="stat-card insert-card">
          <span>Inserts Received</span>
          <strong>{counts.INSERT}</strong>
        </article>
        <article className="stat-card update-card">
          <span>Updates Received</span>
          <strong>{counts.UPDATE}</strong>
        </article>
        <article className="stat-card delete-card">
          <span>Deletes Received</span>
          <strong>{counts.DELETE}</strong>
        </article>
      </section>

      <section className="content-grid">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <h2>Change Event Stream</h2>
              <p>Newest events appear first</p>
            </div>
            <span className="live-label">LIVE</span>
          </div>

          {events.length === 0 ? (
            <div className="empty">
              <span>◉</span>
              <h3>Waiting for database events</h3>
              <p>Insert, update, or delete a student through the API.</p>
            </div>
          ) : (
            <div className="event-list">
              {events.map((event, index) => (
                <article
                  className="event-item"
                  key={`${event.time}-${event.operation}-${event.id}-${index}`}
                >
                  <span className={`badge ${event.operation.toLowerCase()}`}>
                    {event.operation}
                  </span>

                  <div className="event-details">
                    <strong>
                      {event.operation === "INSERT" && `${event.name} created`}
                      {event.operation === "UPDATE" &&
                        `${event.after?.name ?? event.before?.name ?? "Student"} updated`}
                      {event.operation === "DELETE" &&
                        `${event.before?.name ?? "Student"} deleted`}
                    </strong>

                    <p>
                      Record ID: {event.id}
                      {event.operation === "UPDATE" &&
                        ` · Marks: ${event.before?.marks} → ${event.after?.marks}`}
                      {event.operation === "INSERT" &&
                        ` · Marks: ${event.marks}`}
                      {event.operation === "DELETE" &&
                        ` · Previous marks: ${event.before?.marks}`}
                    </p>

                    <time>
                      {event.time
                        ? new Date(event.time).toLocaleString()
                        : "Time unavailable"}
                    </time>
                  </div>
                </article>
              ))}
            </div>
          )}
        </article>

        <article className="panel">
          <div className="panel-heading">
            <div>
              <h2>Student Records</h2>
              <p>Current API-backed snapshot</p>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Marks</th>
                </tr>
              </thead>
              <tbody>
                {students.map((student) => (
                  <tr key={student.id}>
                    <td>#{student.id}</td>
                    <td>{student.name}</td>
                    <td>{student.marks}</td>
                  </tr>
                ))}
                {students.length === 0 && (
                  <tr>
                    <td colSpan="3" className="empty-cell">
                      No student records found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <footer>
        <span>CDC Monitor · Development Preview</span>
        <span>Node.js · MySQL · React · SSE</span>
      </footer>
    </main>
  );
}

export default App;
