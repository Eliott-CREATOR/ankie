import type { ClozeProductionBack, ClozeProductionFront } from "@ankie/core";
import { emphasizeWord } from "./Recognition.js";

export function ClozeProduction({
  front,
  back,
  revealed,
}: {
  front: ClozeProductionFront;
  back: ClozeProductionBack;
  revealed: boolean;
}) {
  return revealed ? (
    <div className="back">
      <p className="definition">{emphasizeWord(back.sentence, back.answer)}</p>
      <p className="word">{back.answer}</p>
      <p className="gloss">{back.gloss_l1}</p>
      {back.definition_l2 && <p className="definition">{back.definition_l2}</p>}
    </div>
  ) : (
    <>
      <p className="definition">{front.sentence_blanked}</p>
      <p className="gloss">{front.hint_l1}</p>
      <p className="context">First letter: {front.first_letter}</p>
    </>
  );
}
