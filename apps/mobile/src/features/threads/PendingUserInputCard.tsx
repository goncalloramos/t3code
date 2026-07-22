import {
  derivePendingUserInputProgress,
  findFirstUnansweredPendingUserInputQuestionIndex,
  type PendingUserInputDraftAnswer,
} from "@t3tools/client-runtime/pending-user-input";
import type { ApprovalRequestId } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { cn } from "../../lib/cn";
import type { PendingUserInput } from "../../lib/threadActivity";

export interface PendingUserInputCardProps {
  readonly pendingUserInput: PendingUserInput;
  readonly drafts: Record<string, PendingUserInputDraftAnswer>;
  readonly answers: Record<string, string | string[]> | null;
  readonly respondingUserInputId: ApprovalRequestId | null;
  readonly onSelectOption: (
    requestId: ApprovalRequestId,
    questionId: string,
    label: string,
  ) => void;
  readonly onChangeCustomAnswer: (
    requestId: ApprovalRequestId,
    questionId: string,
    customAnswer: string,
  ) => void;
  readonly onSubmit: () => Promise<unknown>;
}

export function PendingUserInputCard(props: PendingUserInputCardProps) {
  return <PendingUserInputQuestionFlow key={props.pendingUserInput.requestId} {...props} />;
}

function PendingUserInputQuestionFlow(props: PendingUserInputCardProps) {
  const { height } = useWindowDimensions();
  const [questionIndex, setQuestionIndex] = useState(() =>
    findFirstUnansweredPendingUserInputQuestionIndex(
      props.pendingUserInput.questions,
      props.drafts,
    ),
  );
  const autoAdvanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestPropsRef = useRef(props);
  latestPropsRef.current = props;

  const progress = derivePendingUserInputProgress(
    props.pendingUserInput.questions,
    props.drafts,
    questionIndex,
  );
  const activeQuestion = progress.activeQuestion;
  const isResponding = props.respondingUserInputId === props.pendingUserInput.requestId;

  useEffect(
    () => () => {
      if (autoAdvanceTimerRef.current !== null) clearTimeout(autoAdvanceTimerRef.current);
    },
    [],
  );

  if (!activeQuestion) return null;

  const advance = () => {
    const latestProps = latestPropsRef.current;
    const latestProgress = derivePendingUserInputProgress(
      latestProps.pendingUserInput.questions,
      latestProps.drafts,
      questionIndex,
    );
    if (!latestProgress.canAdvance) return;
    if (latestProgress.isLastQuestion) {
      if (latestProps.answers !== null) void latestProps.onSubmit();
      return;
    }
    setQuestionIndex(latestProgress.questionIndex + 1);
  };

  const selectOption = (label: string) => {
    if (isResponding) return;
    props.onSelectOption(props.pendingUserInput.requestId, activeQuestion.id, label);
    if (activeQuestion.multiSelect) return;
    if (autoAdvanceTimerRef.current !== null) clearTimeout(autoAdvanceTimerRef.current);
    autoAdvanceTimerRef.current = setTimeout(() => {
      autoAdvanceTimerRef.current = null;
      advance();
    }, 200);
  };

  return (
    <View
      className="gap-3 rounded-[20px] border border-neutral-200 bg-neutral-100/95 p-4 dark:border-white/6 dark:bg-neutral-900/95"
      style={{ maxHeight: Math.max(300, height * 0.68), borderCurve: "continuous" }}
    >
      <View className="flex-row items-center justify-between gap-3">
        <View className="min-w-0 flex-1 gap-1">
          <Text
            selectable
            className="font-t3-bold text-2xs uppercase tracking-[1.1px] text-sky-700 dark:text-sky-300"
          >
            {activeQuestion.header}
          </Text>
          <Text selectable className="font-t3-bold text-lg text-neutral-950 dark:text-neutral-50">
            User input needed
          </Text>
        </View>
        {props.pendingUserInput.questions.length > 1 ? (
          <View className="rounded-lg bg-neutral-200/80 px-2 py-1 dark:bg-neutral-800">
            <Text
              selectable
              className="font-t3-bold text-xs text-neutral-600 dark:text-neutral-300"
              style={{ fontVariant: ["tabular-nums"] }}
            >
              {progress.questionIndex + 1} of {props.pendingUserInput.questions.length}
            </Text>
          </View>
        ) : null}
      </View>

      <ScrollView
        style={{ maxHeight: Math.max(170, height * 0.42) }}
        contentContainerStyle={{ gap: 10, paddingBottom: 2 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator
      >
        <Animated.View
          key={activeQuestion.id}
          entering={FadeIn.duration(160)}
          exiting={FadeOut.duration(100)}
          className="gap-2.5"
        >
          <Text
            selectable
            className="font-sans text-base leading-snug text-neutral-950 dark:text-neutral-50"
          >
            {activeQuestion.question}
          </Text>
          {activeQuestion.multiSelect ? (
            <Text selectable className="font-sans text-xs text-neutral-500 dark:text-neutral-400">
              Select one or more options.
            </Text>
          ) : null}
          <View className="gap-2">
            {activeQuestion.options.map((option) => {
              const selected =
                !progress.usingCustomAnswer && progress.selectedOptionLabels.includes(option.label);
              return (
                <Pressable
                  key={option.label}
                  accessibilityRole={activeQuestion.multiSelect ? "checkbox" : "radio"}
                  accessibilityState={{ checked: selected, disabled: isResponding }}
                  className={cn(
                    "min-h-12 flex-row items-center gap-3 rounded-2xl border px-3.5 py-3",
                    selected
                      ? "border-blue-300/60 bg-blue-50 dark:border-blue-400/32 dark:bg-blue-400/14"
                      : "border-neutral-200 bg-white dark:border-white/6 dark:bg-neutral-950/70",
                    isResponding && "opacity-50",
                  )}
                  style={{ borderCurve: "continuous" }}
                  disabled={isResponding}
                  onPress={() => selectOption(option.label)}
                >
                  <View className="min-w-0 flex-1 gap-0.5">
                    <Text
                      selectable
                      className={cn(
                        "font-t3-bold text-sm",
                        selected
                          ? "text-sky-700 dark:text-sky-300"
                          : "text-neutral-800 dark:text-neutral-100",
                      )}
                    >
                      {option.label}
                    </Text>
                    {option.description && option.description !== option.label ? (
                      <Text
                        selectable
                        className="font-sans text-xs leading-normal text-neutral-500 dark:text-neutral-400"
                      >
                        {option.description}
                      </Text>
                    ) : null}
                  </View>
                  {selected ? (
                    <SymbolView
                      name="checkmark.circle"
                      size={18}
                      tintColor="#0a84ff"
                      type="monochrome"
                    />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
          <TextInput
            value={progress.customAnswer}
            onChangeText={(value) =>
              props.onChangeCustomAnswer(props.pendingUserInput.requestId, activeQuestion.id, value)
            }
            placeholder="Or type a custom answer"
            multiline
            editable={!isResponding}
            className="min-h-[54px] rounded-2xl border border-neutral-200 bg-white px-3.5 py-3 font-sans text-base text-neutral-950 dark:border-white/8 dark:bg-neutral-950/70 dark:text-neutral-50"
            style={{ borderCurve: "continuous" }}
          />
        </Animated.View>
      </ScrollView>

      <View className="flex-row gap-2.5">
        {progress.questionIndex > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous question"
            className="min-h-12 items-center justify-center rounded-2xl bg-neutral-200 px-4 dark:bg-neutral-800"
            disabled={isResponding}
            onPress={() => setQuestionIndex((current) => Math.max(0, current - 1))}
          >
            <Text className="font-t3-bold text-sm text-neutral-800 dark:text-neutral-100">
              Back
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={progress.isLastQuestion ? "Submit answers" : "Next question"}
          className={cn(
            "min-h-12 flex-1 items-center justify-center rounded-2xl px-4",
            progress.canAdvance && (!progress.isLastQuestion || progress.isComplete)
              ? "bg-blue-500"
              : "bg-neutral-200 dark:bg-neutral-700/60",
          )}
          disabled={
            isResponding ||
            !progress.canAdvance ||
            (progress.isLastQuestion && !progress.isComplete)
          }
          onPress={advance}
        >
          <Text className="font-t3-extrabold text-sm text-white">
            {isResponding ? "Submitting…" : progress.isLastQuestion ? "Submit" : "Next"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
