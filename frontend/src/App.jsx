
import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import "./App.css";

const API = "http://127.0.0.1:8001";
const FILTERS = ["ALL", "INSERT", "UPDATE", "DELETE"];
const MAX_EVENTS = 50;

function getEventKey(event) {
  return event.historyId
    ? `history-${event.historyId}`
    : `${event.time}-${event.operation}-${event.id}`;
}

function App() {
  const [students, setStudents] = useState([]);
  const [events, setEvents] = useState([]);
  const [connected, setConnected] = useState(false);
  const [filter, setFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [analyticsSummary, setAnalyticsSummary] = useState(null);
  const [activityRows, setActivityRows] = useState([]);
  const [analyticsError, setAnalyticsError] = useState(false);

  useEffect(() => {
    let active = true;

    axios
      .get(`${API}/students`)
      .then((response) => {
        if (active) setStudents(response.data);
      })
      .catch((error) => {
        console.error("Student fetch failed:", error.message);
      });

    axios
      .get(`${API}/events/history`)
      .then((response) => {
        if (!active) return;

        const history = Array.isArray(response.data)
          ? response.data
          : [];

        setEvents((previous) => {
          const combined = [...previous, ...history];
          const seen = new Set();

          return combined
            .filter((event) => {
              const key = getEventKey(event);
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            })
            .sort(
              (a, b) =>
                new Date(b.time).getTime() -
                new Date(a.time).getTime()
            )
            .slice(0, MAX_EVENTS);
        });
      })
      .catch((error) => {
        console.error("Event history fetch failed:", error.message);
      });

    const source = new EventSource(`${API}/events`);

    source.onopen = () => {
      if (active) setConnected(true);
    };

    source.onerror = () => {
      if (active) setConnected(false);
    };

    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data);
        if (!event.operation) return;

        setEvents((previous) => {
          const key = getEventKey(event);

          if (previous.some((item) => getEventKey(item) === key)) {
            return previous;
          }

          return [event, ...previous].slice(0, MAX_EVENTS);
        });

        if (event.operation === "INSERT") {
          const student = event.after ?? {
            id: event.id,
            name: event.name,
            marks: event.marks,
          };

          setStudents((previous) => {
            const withoutDuplicate = previous.filter(
              (item) => item.id !== student.id
            );

            return [...withoutDuplicate, student].sort(
              (a, b) => a.id - b.id
            );
          });
        }

        if (event.operation === "UPDATE" && event.after) {
          setStudents((previous) =>
            previous.map((student) =>
              student.id === event.after.id
                ? { ...student, ...event.after }
                : student
            )
          );
        }

        if (event.operation === "DELETE") {
          const deletedId = event.before?.id ?? event.id;

          setStudents((previous) =>
            previous.filter((student) => student.id !== deletedId)
          );
        }
      } catch (error) {
        console.error("Invalid CDC event:", error.message);
      }
    };

    return () => {
      active = false;
      source.close();
    };
  }, []);
  useEffect(() => {
    let active = true;

    const loadAnalytics = async () => {
      try {
        const [summaryResponse, activityResponse] = await Promise.all([
          axios.get(`${API}/analytics/summary`),
          axios.get(`${API}/analytics/activity`),
        ]);

        if (!active) return;

        setAnalyticsSummary(summaryResponse.data);
        setActivityRows(
          Array.isArray(activityResponse.data)
            ? activityResponse.data
            : []
        );
        setAnalyticsError(false);
      } catch (error) {
        if (!active) return;

        setAnalyticsError(true);
        console.error("Analytics fetch failed:", error.message);
      }
    };

    loadAnalytics();

    const interval = setInterval(loadAnalytics, 30000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);
  const counts = useMemo(
    () => ({
      INSERT: events.filter((event) => event.operation === "INSERT").length,
      UPDATE: events.filter((event) => event.operation === "UPDATE").length,
      DELETE: events.filter((event) => event.operation === "DELETE").length,
    }),
    [events]
  );

  const activity = useMemo(() => {
    const now = new Date();
    now.setMinutes(0, 0, 0);

    const hourKey = (date) =>
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}`;

    const buckets = Array.from({ length: 24 }, (_, index) => {
      const start = new Date(now);
      start.setHours(now.getHours() - (23 - index));

      return {
        key: hourKey(start),
        label: start.toLocaleTimeString([], {
          hour: "2-digit",
          hour12: false,
        }),
        INSERT: 0,
        UPDATE: 0,
        DELETE: 0,
      };
    });

    const bucketMap = new Map(
      buckets.map((bucket) => [bucket.key, bucket])
    );

    for (const row of activityRows) {
      if (!row.hour) continue;

      const bucket = bucketMap.get(String(row.hour).slice(0, 13));
      if (!bucket) continue;

      bucket.INSERT = Number(row.inserts || 0);
      bucket.UPDATE = Number(row.updates || 0);
      bucket.DELETE = Number(row.deletes || 0);
    }

    return buckets;
  }, [activityRows]);

  const chartMax = Math.max(
    1,
    ...activity.map(
      (bucket) => bucket.INSERT + bucket.UPDATE + bucket.DELETE
    )
  );

  const filteredEvents = useMemo(() => {
    const term = search.trim().toLowerCase();

    return events.filter((event) => {
      const matchesFilter =
        filter === "ALL" || event.operation === filter;

      const name =
        event.name ??
        event.after?.name ??
        event.before?.name ??
        "";

      const matchesSearch =
        !term ||
        String(name).toLowerCase().includes(term) ||
        String(event.id ?? "").includes(term) ||
        String(event.operation ?? "").toLowerCase().includes(term);

      return matchesFilter && matchesSearch;
    });
  }, [events, filter, search]);

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
          {connected ? "Stream Connected" : "Stream Disconnected"}
        </div>
      </header>

      <section className="stats">
        <article className="stat-card">
          <span>Total Students</span>
          <strong>
            {analyticsSummary?.totalStudents ?? students.length}
          </strong>
          <small>Current database snapshot</small>
        </article>

        <article className="stat-card">
          <span>Total Events</span>
          <strong>
            {analyticsSummary?.totalEvents ?? events.length}
          </strong>
          <small>All recorded database events</small>
        </article>

        <article className="stat-card insert-card">
          <span>Inserts</span>
          <strong>
            {analyticsSummary?.inserts ?? counts.INSERT}
          </strong>
          <small>All recorded inserts</small>
        </article>

        <article className="stat-card update-card">
          <span>Updates</span>
          <strong>
            {analyticsSummary?.updates ?? counts.UPDATE}
          </strong>
          <small>All recorded updates</small>
        </article>

        <article className="stat-card delete-card">
          <span>Deletes</span>
          <strong>
            {analyticsSummary?.deletes ?? counts.DELETE}
          </strong>
          <small>All recorded deletes</small>
        </article>
      </section>

      <section className="panel analytics-panel">
        <div className="panel-heading">
          <div>
            <h2>Database Activity</h2>
            <p>Hourly event distribution · Last 24 hours</p>
          </div>
          <span className={`live-label ${connected ? "" : "chart-offline"}`}>
            {connected ? "LIVE" : "OFFLINE"}
          </span>
        </div>

        <div className="chart-legend">
          <span><i className="legend-insert" /> INSERT</span>
          <span><i className="legend-update" /> UPDATE</span>
          <span><i className="legend-delete" /> DELETE</span>
        </div>

        <div
          className="activity-chart"
          role="img"
          aria-label="Stacked bar chart showing hourly INSERT, UPDATE and DELETE events over the last 12 hours"
        >
          {activity.map((bucket) => {
            const total =
              bucket.INSERT + bucket.UPDATE + bucket.DELETE;

            const height = (total / chartMax) * 100;

            return (
              <div className="chart-column" key={bucket.key}>
                <span className="chart-value">{total || ""}</span>

                <div className="bar-track">
                  <div
                    className="stacked-bar"
                    style={{ height: `${height}%` }}
                    title={`${bucket.label}: ${bucket.INSERT} inserts, ${bucket.UPDATE} updates, ${bucket.DELETE} deletes`}
                  >
                    {bucket.DELETE > 0 && (
                      <div
                        className="bar-delete"
                        style={{ flex: bucket.DELETE }}
                      />
                    )}
                    {bucket.UPDATE > 0 && (
                      <div
                        className="bar-update"
                        style={{ flex: bucket.UPDATE }}
                      />
                    )}
                    {bucket.INSERT > 0 && (
                      <div
                        className="bar-insert"
                        style={{ flex: bucket.INSERT }}
                      />
                    )}
                  </div>
                </div>

                <span className="chart-time">{bucket.label}</span>
              </div>
            );
          })}
        </div>

        {events.length === 0 && (
          <p className="chart-note">
            {analyticsError
              ? "Analytics unavailable. Check the backend API."
              : "Historical activity from MySQL. Refreshes every 30 seconds."}
          </p>
        )}


      </section>

      <section className="content-grid">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <h2>Change Event Stream</h2>
              <p>Showing up to 50 recent events, newest first</p>
            </div>

            <span className="live-label">
              {connected ? "LIVE" : "OFFLINE"}
            </span>
          </div>

          <div className="event-tools">
            <input
              type="search"
              className="event-search"
              placeholder="Search by name, ID or operation..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Search events"
            />

            <div className="filter-bar" aria-label="Filter events">
              {FILTERS.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`filter-button ${filter === item ? "active" : ""
                    }`}
                  onClick={() => setFilter(item)}
                >
                  {item === "ALL" ? `All (${events.length})` : item}
                </button>
              ))}
            </div>
          </div>

          {filteredEvents.length === 0 ? (
            <div className="empty">
              <span>◉</span>
              <h3>
                {events.length === 0
                  ? "Waiting for database events"
                  : "No matching events"}
              </h3>
              <p>
                {events.length === 0
                  ? "Saved events will appear here. Try a database change if the history is empty."
                  : "Try a different operation filter or search term."}
              </p>
            </div>
          ) : (
            <div className="event-list">
              {filteredEvents.map((event, index) => {
                const name =
                  event.name ??
                  event.after?.name ??
                  event.before?.name ??
                  "Student";

                return (
                  <article
                    className="event-item"
                    key={`${getEventKey(event)}-${index}`}
                  >
                    <span
                      className={`badge ${String(
                        event.operation
                      ).toLowerCase()}`}
                    >
                      {event.operation}
                    </span>

                    <div className="event-details">
                      <strong>
                        {name}{" "}
                        {event.operation === "INSERT" && "created"}
                        {event.operation === "UPDATE" && "updated"}
                        {event.operation === "DELETE" && "deleted"}
                      </strong>

                      <p>
                        Record ID: {event.id ?? "Unknown"}
                        {event.operation === "INSERT" &&
                          ` · Marks: ${event.marks ?? event.after?.marks ?? "—"
                          }`}
                        {event.operation === "UPDATE" &&
                          ` · Marks: ${event.before?.marks ?? "—"
                          } → ${event.after?.marks ?? "—"}`}
                        {event.operation === "DELETE" &&
                          ` · Previous marks: ${event.before?.marks ?? event.marks ?? "—"
                          }`}
                      </p>

                      <div className="event-meta">
                        <time>
                          {event.time &&
                            !Number.isNaN(new Date(event.time).getTime())
                            ? new Date(event.time).toLocaleString()
                            : "Time unavailable"}
                        </time>

                        <span className="source-label">
                          {event.source === "mysql-binlog"
                            ? "MySQL Binlog"
                            : "CDC Event"}
                        </span>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </article>

        <article className="panel">
          <div className="panel-heading">
            <div>
              <h2>Student Records</h2>
              <p>Current database snapshot</p>
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
        <span>Node.js · MySQL Binlog · React · SSE</span>
      </footer>
    </main>
  );
}

export default App;
