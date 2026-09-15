import type { ReactNode } from "react";

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

// Bolds the target word inside the source sentence for the reveal's emphasised-source line.
export function emphasizeWord(sentence: string, word: string): ReactNode {
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

export function Recognition({
  front,
  back,
  revealed,
  onReveal,
}: {
  front: CardFront;
  back: CardBack;
  revealed: boolean;
  onReveal: () => void;
}) {
  return (
    <>
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
        <button type="button" className="card-area" onClick={onReveal}>
          <p className="word">{front.word}</p>
          <p className="context">{front.context_sentence}</p>
        </button>
      )}
    </>
  );
}

export function parseRecognition(front: string, back: string) {
  return { front: JSON.parse(front) as CardFront, back: JSON.parse(back) as CardBack };
}
