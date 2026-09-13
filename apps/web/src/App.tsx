import type { CardRow } from "@ankie/core";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

interface DueResponse {
  cards: CardRow[];
  nextDueAt: number | null;
}

interface CardFront {
  word: string;
  context_sentence: string;
}

interface CardBack {
  word: string;
  gloss_l1: string | null;
  definition_l2: string | null;
  context_sentence: string;
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

function HomeScreen({
  due,
  onStartReview,
}: { due: DueResponse | null; onStartReview: () => void }) {
  return (
    <div className="home">
      <h1 className="app-title">Ankie</h1>
      {due === null ? (
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
  const shownAt = useRef(Date.now());
  const currentCard = cards[index];

  // The queue empties into the home screen, not a second empty-state — home already owns that.
  useEffect(() => {
    if (!currentCard) {
      onFinish();
    }
  }, [currentCard, onFinish]);

  const handleReveal = useCallback(() => setRevealed(true), []);

  const handleRate = useCallback(
    (rating: (typeof RATINGS)[number]["rating"]) => {
      if (!currentCard) {
        return;
      }
      const durationMs = Date.now() - shownAt.current;

      fetch("/api/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cardId: currentCard.id,
          rating,
          reviewedAt: Date.now(),
          durationMs,
        }),
      }).catch(() => {
        // Best-effort for C1 (online-only) — offline queuing/retry is C4's job.
      });

      setIndex((i) => i + 1);
      setRevealed(false);
      shownAt.current = Date.now();
    },
    [currentCard],
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
            <p className="source">{emphasizeWord(back.context_sentence, back.word)}</p>
          </div>
        </div>
      ) : (
        <button type="button" className="card-area" onClick={handleReveal}>
          <p className="word">{front.word}</p>
          <p className="context">{front.context_sentence}</p>
        </button>
      )}

      {revealed && (
        <div className="rating-row">
          {RATINGS.map(({ rating, label, className }) => (
            <button
              key={rating}
              type="button"
              className={`rating-btn ${className}`}
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

  const fetchDue = useCallback(() => {
    fetch("/api/due")
      .then((res) => res.json() as Promise<DueResponse>)
      .then(setDue)
      .catch(() => setDue({ cards: [], nextDueAt: null }));
  }, []);

  useEffect(() => {
    if (screen === "home") {
      fetchDue();
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

  if (screen === "review" && due) {
    return <ReviewScreen cards={due.cards} onFinish={exitReview} />;
  }

  return <HomeScreen due={due} onStartReview={enterReview} />;
}
