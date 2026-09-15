import type { CollocationBack, CollocationFront } from "@ankie/core";

export function Collocation({
  front,
  back,
  revealed,
}: {
  front: CollocationFront;
  back: CollocationBack;
  revealed: boolean;
}) {
  return revealed ? (
    <div className="back">
      <p className="definition">Accepted answers: {back.accepted.join(", ")}</p>
      <ul className="examples">
        {back.collocations.map((collocation) => (
          <li key={collocation}>{collocation}</li>
        ))}
      </ul>
    </div>
  ) : (
    <>
      <p className="word">{front.word}</p>
      <p className="definition">{front.pattern}</p>
    </>
  );
}
