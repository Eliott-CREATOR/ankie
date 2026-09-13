import { useEffect, useState } from "react";

const API_URL = "/health";

interface HealthResponse {
  ok: boolean;
  version: string;
  dbReachable: boolean;
}

type Status =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "loaded"; data: HealthResponse };

export function App() {
  const [status, setStatus] = useState<Status>({ state: "loading" });

  useEffect(() => {
    fetch(API_URL)
      .then((res) => res.json() as Promise<HealthResponse>)
      .then((data) => setStatus({ state: "loaded", data }))
      .catch((err: unknown) =>
        setStatus({ state: "error", message: err instanceof Error ? err.message : "fetch failed" }),
      );
  }, []);

  return (
    <div className="page">
      <div>
        <p className="eyebrow stagger">ANKIE</p>
        <p className="title stagger">system status</p>
        <div className="card stagger">
          {status.state === "loading" && (
            <div className="row">
              <span className="row-label">checking /health…</span>
            </div>
          )}
          {status.state === "error" && (
            <div className="row">
              <span className="row-label">
                <span className="dot dot--error" />
                unreachable
              </span>
              <span className="row-value">{status.message}</span>
            </div>
          )}
          {status.state === "loaded" && (
            <>
              <div className="row">
                <span className="row-label">
                  <span className={`dot ${status.data.ok ? "dot--ok" : "dot--error"}`} />
                  ok
                </span>
                <span className="row-value">{String(status.data.ok)}</span>
              </div>
              <div className="row">
                <span className="row-label">version</span>
                <span className="row-value">{status.data.version}</span>
              </div>
              <div className="row">
                <span className="row-label">
                  <span className={`dot ${status.data.dbReachable ? "dot--ok" : "dot--error"}`} />
                  db
                </span>
                <span className="row-value">{String(status.data.dbReachable)}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
