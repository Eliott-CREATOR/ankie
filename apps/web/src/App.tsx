import type { DueCard } from "@ankie/core";
import { useCallback, useEffect, useState } from "react";
import { apiHeaders, clearApiSecret, getApiSecret, setApiSecret } from "./apiSecret.js";
import { ReviewScreen } from "./review/ReviewScreen.js";

interface DueResponse {
  cards: DueCard[];
  nextDueAt: number | null;
}

function formatNextDue(ts: number): string {
  return new Date(ts).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
}

// Shown until a secret is stored, and again whenever the server rejects the stored one.
function SecretScreen({
  error,
  onSubmit,
}: { error: string | null; onSubmit: (s: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <form
      className="home"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim().length > 0) {
          onSubmit(value.trim());
        }
      }}
    >
      <h1 className="app-title">Ankie</h1>
      <p className="status-line">Enter the app secret to load your deck.</p>
      <input
        className="secret-input"
        type="password"
        autoComplete="current-password"
        placeholder="Secret"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      {error && <p className="error-line">{error}</p>}
      <button type="submit" className="primary-btn">
        Continue
      </button>
    </form>
  );
}

function HomeScreen({
  due,
  error,
  onStartReview,
}: { due: DueResponse | null; error: string | null; onStartReview: () => void }) {
  return (
    <div className="home">
      <h1 className="app-title">Ankie</h1>
      {error ? (
        <p className="error-line">{error}</p>
      ) : due === null ? (
        <p className="status-line">Loading…</p>
      ) : due.cards.length > 0 ? (
        <button type="button" className="primary-btn" onClick={onStartReview}>
          Review · {due.cards.length} due
        </button>
      ) : (
        <p className="status-line">
          Nothing due{due.nextDueAt !== null ? ` — next card ${formatNextDue(due.nextDueAt)}` : ""}
        </p>
      )}
    </div>
  );
}

type Screen = "home" | "review";

export function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [due, setDue] = useState<DueResponse | null>(null);
  const [needsSecret, setNeedsSecret] = useState(() => getApiSecret() === null);
  const [error, setError] = useState<string | null>(null);

  // Every failure is shown, none is turned into an empty deck (docs/prompts/c2.md: never swallow
  // an error). A 401 clears the stored secret and returns to the prompt.
  const fetchDue = useCallback(async () => {
    if (getApiSecret() === null) {
      setNeedsSecret(true);
      return;
    }
    setError(null);
    try {
      const res = await fetch("/api/due", { headers: apiHeaders() });
      if (res.status === 401) {
        clearApiSecret();
        setDue(null);
        setError("Secret rejected — enter it again.");
        setNeedsSecret(true);
        return;
      }
      if (!res.ok) {
        setError(`Couldn't load the deck (${res.status}).`);
        return;
      }
      setDue((await res.json()) as DueResponse);
    } catch {
      setError("Couldn't load the deck — check your connection.");
    }
  }, []);

  const saveSecret = useCallback(
    (secret: string) => {
      setApiSecret(secret);
      setNeedsSecret(false);
      setError(null);
      void fetchDue();
    },
    [fetchDue],
  );

  useEffect(() => {
    if (screen === "home") {
      void fetchDue();
    }
  }, [screen, fetchDue]);

  // Two screens don't justify a router: pushState on entering review, popstate returns home —
  // this also makes the iOS back-swipe return to the menu instead of closing the app.
  useEffect(() => {
    function onPopState() {
      setScreen("home");
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const enterReview = useCallback(() => {
    window.history.pushState({ screen: "review" }, "");
    setScreen("review");
  }, []);

  const exitReview = useCallback(() => {
    window.history.back();
  }, []);

  if (needsSecret) {
    return <SecretScreen error={error} onSubmit={saveSecret} />;
  }

  if (screen === "review" && due) {
    return <ReviewScreen cards={due.cards} onFinish={exitReview} />;
  }

  return <HomeScreen due={due} error={error} onStartReview={enterReview} />;
}
