import { describe, expect, it } from "vite-plus/test";

import type { UserInputQuestion } from "@t3tools/contracts";

import {
  buildPendingUserInputAnswers,
  derivePendingUserInputProgress,
  findFirstUnansweredPendingUserInputQuestionIndex,
  setPendingUserInputCustomAnswer,
  togglePendingUserInputOptionSelection,
} from "./pendingUserInput.js";

const questions: ReadonlyArray<UserInputQuestion> = [
  {
    id: "scope",
    header: "Scope",
    question: "What should change?",
    options: [{ label: "Mobile", description: "Update the phone UI" }],
    multiSelect: false,
  },
  {
    id: "platforms",
    header: "Platforms",
    question: "Which platforms?",
    options: [
      { label: "iOS", description: "Apple devices" },
      { label: "Android", description: "Android devices" },
    ],
    multiSelect: true,
  },
];

describe("pending user input", () => {
  it("resolves single- and multi-select answers", () => {
    expect(
      buildPendingUserInputAnswers(questions, {
        scope: { selectedOptionLabels: ["Mobile"] },
        platforms: { selectedOptionLabels: ["iOS", "Android"] },
      }),
    ).toEqual({ scope: "Mobile", platforms: ["iOS", "Android"] });
  });

  it("lets a custom answer override and then restore option selections", () => {
    const selected = { selectedOptionLabels: ["Mobile"] };
    const custom = setPendingUserInputCustomAnswer(selected, "Desktop too");
    expect(custom).toEqual({ customAnswer: "Desktop too", selectedOptionLabels: ["Mobile"] });
    expect(setPendingUserInputCustomAnswer(custom, "")).toEqual({
      customAnswer: "",
      selectedOptionLabels: ["Mobile"],
    });
  });

  it("toggles multi-select choices without affecting other choices", () => {
    const question = questions[1]!;
    const selected = togglePendingUserInputOptionSelection(question, undefined, "iOS");
    expect(togglePendingUserInputOptionSelection(question, selected, "Android")).toEqual({
      customAnswer: "",
      selectedOptionLabels: ["iOS", "Android"],
    });
  });

  it("derives bounded progress and the first unanswered question", () => {
    const drafts = { scope: { selectedOptionLabels: ["Mobile"] } };
    expect(findFirstUnansweredPendingUserInputQuestionIndex(questions, drafts)).toBe(1);
    expect(derivePendingUserInputProgress(questions, drafts, 99)).toMatchObject({
      questionIndex: 1,
      isLastQuestion: true,
      canAdvance: false,
      isComplete: false,
    });
  });
});
