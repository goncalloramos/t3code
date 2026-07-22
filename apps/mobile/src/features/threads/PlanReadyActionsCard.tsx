import { Pressable, useWindowDimensions, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { cn } from "../../lib/cn";

export interface PlanReadyActionsCardProps {
  readonly title: string;
  readonly disabled: boolean;
  readonly implementingTarget: "here" | "new-thread" | null;
  readonly onImplementHere: () => void;
  readonly onImplementInNewThread: () => void;
}

export function PlanReadyActionsCard(props: PlanReadyActionsCardProps) {
  const { width } = useWindowDimensions();
  const stackActions = width < 350;

  return (
    <View
      className="gap-3 rounded-[20px] border border-violet-200 bg-violet-50/95 p-4 dark:border-violet-400/16 dark:bg-violet-500/10"
      style={{ borderCurve: "continuous" }}
    >
      <View className="gap-1">
        <Text
          selectable
          className="font-t3-bold text-2xs uppercase tracking-[1.1px] text-violet-700 dark:text-violet-300"
        >
          Plan ready
        </Text>
        <Text selectable className="font-t3-bold text-lg text-neutral-950 dark:text-neutral-50">
          {props.title}
        </Text>
        <Text
          selectable
          className="font-sans text-sm leading-normal text-neutral-600 dark:text-neutral-300"
        >
          Run this plan here or start it in a separate thread using the same workspace.
        </Text>
      </View>
      <View className={cn("gap-2.5", stackActions ? "flex-col" : "flex-row")}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Implement plan in this thread"
          className={cn(
            "min-h-12 flex-1 items-center justify-center rounded-2xl px-4",
            props.disabled ? "bg-neutral-300 dark:bg-neutral-700" : "bg-violet-600",
          )}
          style={{ borderCurve: "continuous" }}
          disabled={props.disabled}
          onPress={props.onImplementHere}
        >
          <Text className="font-t3-extrabold text-sm text-white">
            {props.implementingTarget === "here" ? "Starting…" : "Implement here"}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Implement plan in a new thread"
          className={cn(
            "min-h-12 flex-1 items-center justify-center rounded-2xl border px-4",
            props.disabled
              ? "border-neutral-200 bg-neutral-100 dark:border-white/6 dark:bg-neutral-800"
              : "border-violet-300 bg-white dark:border-violet-400/24 dark:bg-neutral-950/80",
          )}
          style={{ borderCurve: "continuous" }}
          disabled={props.disabled}
          onPress={props.onImplementInNewThread}
        >
          <Text className="font-t3-bold text-sm text-violet-800 dark:text-violet-200">
            {props.implementingTarget === "new-thread" ? "Starting…" : "New thread"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
