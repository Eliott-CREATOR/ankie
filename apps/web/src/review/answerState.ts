import { type AnswerResult, checkTypedAnswer } from "@ankie/core";

export interface AnswerState {
  input: string;
  result: AnswerResult | null;
}

export const INITIAL_ANSWER: AnswerState = { input: "", result: null };

export type AnswerAction =
  | { type: "input"; value: string }
  | { type: "check"; accepted: string[] }
  | { type: "unknown" };

// Once checked, preserve the exact attempt through rating and submission retries.
export function answerState(state: AnswerState, action: AnswerAction): AnswerState {
  if (state.result !== null) return state;
  switch (action.type) {
    case "input":
      return { input: action.value, result: null };
    case "check":
      return { ...state, result: checkTypedAnswer(state.input, action.accepted) };
    case "unknown":
      return { input: "", result: "empty" };
  }
}

export const ANSWER_LABELS: Record<AnswerResult, string> = {
  correct: "Correct.",
  almost: "Almost — compare your answer below.",
  wrong: "Wrong — compare your answer below.",
  empty: "No answer — review the answer below.",
};
