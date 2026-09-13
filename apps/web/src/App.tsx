import type { CardRow } from "@ankie/core";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

interface DueResponse {
  cards: CardRow[];
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

export function App() {
  const [queue, setQueue] = useState<CardRow[] | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const shownAt = useRef(Date.now());

  useEffect(() => {
    fetch("/api/due")
      .then((res) => res.json() as Promise<DueResponse>)
      .then((data) => setQueue(data.cards))
      .catch(() => setQueue([]));
  }, []);

  const currentCard = queue?.[index];

  const handleReveal = useCallback(() => {
    setRevealed(true);
  }, []);

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

  if (queue === null) {
    return <div className="empty-state">Loading…</div>;
  }

  if (!currentCard) {
    return <div className="empty-state">Nothing due right now.</div>;
  }

  const front = JSON.parse(currentCard.front) as CardFront;
  const back = JSON.parse(currentCard.back) as CardBack;

  return (
    <div className="app">
      <p className="progress">
        {index + 1} / {queue.length}
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
