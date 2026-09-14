import type { CardRow } from "@ankie/core";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { apiHeaders, clearApiSecret, getApiSecret, setApiSecret } from "./apiSecret.js";
import { submitReview } from "./submitReview.js";

interface DueResponse {
  cards: CardRow[];
  nextDueAt: number | null;
}

interface CardFront {
  word: string;
  context_sentence: string;
}

// Mirrors packages/core/src/materialize.ts — the materialized back is the contract.
interface CardBack {
  word: string;
  gloss_l1: string | null;
  definition_l2: string | null;
  context_sentence: string;
  examples: string[] | null;
}

const RATINGS = [
  { rating: 1, label: "Again", className: "rating-btn--again" },
  { rating: 2, label: "Hard", className: "rating-btn--hard" },
  { rating: 3, label: "Good", className: "rating-btn--good" },
  { rating: 4, label: "Easy", className: "rating-btn--easy" },
] as const;

// Bolds the target word inside the source sentence for the reveal's emphasised-source line.
function emphasizeWord(sentence: string, word: string): ReactNode {
  const idx = sentence.toLowerCase().indexOf(word.toLowerCase());
  if (idx === -1) {
    return sentence;
  }
  return (
    <>
      {sentence.slice(0, idx)}
      <strong>{sentence.slice(idx, idx + word.length)}</strong>
      {sentence.slice(idx + word.length)}
    </>
  );
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

function ReviewScreen({ cards, onFinish }: { cards: CardRow[]; onFinish: () => void }) {
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shownAt = useRef(Date.now());
  // Reused across retries of the same card so a resubmitted request is recognisable as a repeat
  // (apps/worker/src/routes/review.ts) rather than applying the rating twice.
  const pendingId = useRef<{ cardId: string; id: string } | null>(null);
  const currentCard = cards[index];
  const currentCardId = currentCard?.id;

  // The queue empties into the home screen, not a second empty-state — home already owns that.
  useEffect(() => {
    if (!currentCard) {
      onFinish();
    }
  }, [currentCard, onFinish]);

  // Timer starts when a card actually renders, not when the screen mounts — a failed submission
  // doesn't advance the card, so this doesn't refire, and duration on retry still reflects the
  // whole time the card was up, not just the moment of the second tap.
  useEffect(() => {
    if (currentCardId) {
      shownAt.current = Date.now();
    }
  }, [currentCardId]);

  const handleReveal = useCallback(() => setRevealed(true), []);

  const handleRate = useCallback(
    async (rating: (typeof RATINGS)[number]["rating"]) => {
      if (!currentCard || submitting) {
        return;
      }
      if (!pendingId.current || pendingId.current.cardId !== currentCard.id) {
        pendingId.current = { cardId: currentCard.id, id: crypto.randomUUID() };
      }
      const { id } = pendingId.current;
      const durationMs = Date.now() - shownAt.current;

      setSubmitting(true);
      setError(null);

      const result = await submitReview({
        id,
        cardId: currentCard.id,
        rating,
        reviewedAt: Date.now(),
        durationMs,
      });

      setSubmitting(false);

      if (result.ok) {
        pendingId.current = null;
        setIndex((i) => i + 1);
        setRevealed(false);
      } else {
        setError(result.error);
      }
    },
    [currentCard, submitting],
  );

  if (!currentCard) {
    return null; // onFinish() above navigates home
  }

  const front = JSON.parse(currentCard.front) as CardFront;
  const back = JSON.parse(currentCard.back) as CardBack;

  return (
    <div className="app">
      <p className="progress">
        {index + 1} / {cards.length}
      </p>

      {revealed ? (
        <div className="card-area">
          <div className="back">
            {back.definition_l2 && <p className="definition">{back.definition_l2}</p>}
            {back.gloss_l1 && <p className="gloss">{back.gloss_l1}</p>}
            {back.examples && back.examples.length > 0 && (
              <ul className="examples">
                {back.examples.map((example) => (
                  <li key={example}>{emphasizeWord(example, back.word)}</li>
                ))}
              </ul>
            )}
            <p className="source">{emphasizeWord(back.context_sentence, back.word)}</p>
          </div>
        </div>
      ) : (
        <button type="button" className="card-area" onClick={handleReveal}>
          <p className="word">{front.word}</p>
          <p className="context">{front.context_sentence}</p>
        </button>
      )}

      {error && <p className="error-line">{error}</p>}

      {revealed && (
        <div className="rating-row">
          {RATINGS.map(({ rating, label, className }) => (
            <button
              key={rating}
              type="button"
              className={`rating-btn ${className}`}
              disabled={submitting}
              onClick={() => handleRate(rating)}
            >
              {label}
            </button>
          ))}
        </div>
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
