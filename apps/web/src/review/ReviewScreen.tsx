import "./review.css";
import type {
  ClozeProductionBack,
  ClozeProductionFront,
  CollocationBack,
  CollocationFront,
  DueCard,
  ReviewRating,
} from "@ankie/core";
import { type ReactNode, useEffect, useReducer, useRef, useState } from "react";
import { submitReview } from "../submitReview.js";
import { ClozeProduction } from "./ClozeProduction.js";
import { Collocation } from "./Collocation.js";
import { Recognition, parseRecognition } from "./Recognition.js";
import { ANSWER_LABELS, INITIAL_ANSWER, answerState } from "./answerState.js";
import { frequencyLabel, speechLanguage, supportsSpeech } from "./metadata.js";

const RATINGS = [
  { rating: 1, label: "Again", className: "rating-btn--again" },
  { rating: 2, label: "Hard", className: "rating-btn--hard" },
  { rating: 3, label: "Good", className: "rating-btn--good" },
  { rating: 4, label: "Easy", className: "rating-btn--easy" },
] as const;

export function ReviewScreen({ cards, onFinish }: { cards: DueCard[]; onFinish: () => void }) {
  const [index, setIndex] = useState(0);
  const card = cards[index];
  useEffect(() => {
    if (!card) onFinish();
  }, [card, onFinish]);
  if (!card) return null;
  return (
    <ReviewCard
      key={`${index}:${card.id}`}
      card={card}
      index={index}
      total={cards.length}
      onAdvance={() => setIndex((i) => i + 1)}
    />
  );
}

function ReviewCard({
  card,
  index,
  total,
  onAdvance,
}: {
  card: DueCard;
  index: number;
  total: number;
  onAdvance: () => void;
}) {
  const [recognitionRevealed, setRecognitionRevealed] = useState(false);
  const [answer, dispatch] = useReducer(answerState, INITIAL_ANSWER);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const shownAt = useRef(Date.now());
  const pendingId = useRef<string | null>(null);
  const submissionInFlight = useRef(false);
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  const production = card.atom_type === "cloze_production" || card.atom_type === "collocation";
  const known = production || card.atom_type === "recognition";
  const revealed = production ? answer.result !== null : recognitionRevealed;
  const frequency = frequencyLabel(card.frequency_band);
  const speechAvailable = supportsSpeech(window);

  useEffect(() => {
    input.current?.focus();
    return () => {
      if (utterance.current) utterance.current.onerror = null;
      if (speechAvailable) window.speechSynthesis.cancel();
    };
  }, [speechAvailable]);

  async function handleRate(rating: ReviewRating) {
    if (!known || !revealed || submissionInFlight.current) return;
    submissionInFlight.current = true;
    pendingId.current ??= crypto.randomUUID();
    setSubmitting(true);
    setError(null);
    const result = await submitReview({
      id: pendingId.current,
      cardId: card.id,
      rating,
      reviewedAt: Date.now(),
      durationMs: Date.now() - shownAt.current,
      ...(production ? { typedAnswer: answer.input } : {}),
    });
    submissionInFlight.current = false;
    setSubmitting(false);
    if (result.ok) onAdvance();
    else setError(result.error);
  }

  function speak(text: string) {
    setSpeechError(null);
    try {
      // Superseded utterances must not report cancellation against the new playback.
      if (utterance.current) utterance.current.onerror = null;
      window.speechSynthesis.cancel();
      const next = new SpeechSynthesisUtterance(text);
      next.lang = speechLanguage(card);
      next.onerror = (event) => setSpeechError(`Couldn't play audio (${event.error}). Try again.`);
      utterance.current = next;
      window.speechSynthesis.speak(next);
    } catch {
      setSpeechError("Couldn't play audio. Try again.");
    }
  }

  let content: ReactNode;
  let accepted: string[] = [];
  let spokenText: string | null = null;
  switch (card.atom_type) {
    case "recognition": {
      const { front, back } = parseRecognition(card.front, card.back);
      spokenText = front.word;
      content = (
        <Recognition
          front={front}
          back={back}
          revealed={revealed}
          onReveal={() => setRecognitionRevealed(true)}
        />
      );
      break;
    }
    case "cloze_production": {
      const front = JSON.parse(card.front) as ClozeProductionFront;
      const back = JSON.parse(card.back) as ClozeProductionBack;
      accepted = back.accepted;
      spokenText = revealed ? back.sentence : null;
      content = <ClozeProduction front={front} back={back} revealed={revealed} />;
      break;
    }
    case "collocation": {
      const front = JSON.parse(card.front) as CollocationFront;
      const back = JSON.parse(card.back) as CollocationBack;
      accepted = back.accepted;
      spokenText = front.word;
      content = <Collocation front={front} back={back} revealed={revealed} />;
      break;
    }
    default:
      content = (
        <div className="card-area">
          <p className="error-line">
            Unsupported card type: {String(card.atom_type)} (card {card.id}).
          </p>
          <button type="button" className="review-action" onClick={onAdvance}>
            Skip
          </button>
        </div>
      );
  }

  return (
    <div className="app">
      <p className="progress">
        {index + 1} / {total}
      </p>
      {frequency && <p className="frequency-label">{frequency}</p>}
      {production ? (
        <div className="card-area production-area">
          {content}
          <form
            className="answer-form"
            onSubmit={(event) => {
              event.preventDefault();
              dispatch({ type: "check", accepted });
            }}
          >
            <label htmlFor="typed-answer">Your answer</label>
            <input
              ref={input}
              id="typed-answer"
              className="production-input"
              type="text"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="off"
              maxLength={500}
              value={answer.input}
              readOnly={revealed}
              onChange={(event) => dispatch({ type: "input", value: event.target.value })}
            />
            {!revealed && (
              <div className="answer-actions">
                <button type="submit" className="review-action">
                  Check
                </button>
                <button
                  type="button"
                  className="review-action"
                  onClick={() => dispatch({ type: "unknown" })}
                >
                  I don't know
                </button>
              </div>
            )}
            <output className="answer-result" aria-live="polite" aria-atomic="true">
              {answer.result === null ? "" : ANSWER_LABELS[answer.result]}
            </output>
          </form>
        </div>
      ) : (
        content
      )}
      {speechAvailable && spokenText !== null && (
        <button
          type="button"
          className="review-action speak-button"
          onClick={() => speak(spokenText)}
        >
          Speak
        </button>
      )}
      {speechError && (
        <p className="error-line" role="alert">
          {speechError}
        </p>
      )}
      {error && <p className="error-line">{error}</p>}
      {known && revealed && (
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
