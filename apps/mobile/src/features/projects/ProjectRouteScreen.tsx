import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { workspaceAgentState } from "@t3tools/client-runtime/workspace";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { type StaticScreenProps, useNavigation } from "@react-navigation/native";
import { useEffect, useMemo } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { ProjectFavicon } from "../../components/ProjectFavicon";
import { useThemeColor } from "../../lib/useThemeColor";
import { useProject, useThreadShells } from "../../state/entities";
import { relativeTime } from "../../lib/time";
import { currentUiGeneration } from "../../lib/currentUiGeneration";

type ProjectRouteParams = {
  readonly environmentId: string;
  readonly projectId: string;
};

function agentStatus(thread: Parameters<typeof workspaceAgentState>[0]) {
  switch (workspaceAgentState(thread)) {
    case "active":
      return { label: "Working", symbol: "bolt.circle", color: "#0a84ff" } as const;
    case "waiting":
      return {
        label: "Needs attention",
        symbol: "exclamationmark.triangle",
        color: "#ff9f0a",
      } as const;
    case "failed":
      return { label: "Failed", symbol: "xmark.circle.fill", color: "#ff453a" } as const;
    case "completed":
      return { label: "Completed", symbol: "checkmark.circle", color: "#30d158" } as const;
    case "idle":
      return { label: "Ready", symbol: "info.circle", color: "#8e8e93" } as const;
  }
}

function NextProjectRouteScreen({ route }: StaticScreenProps<ProjectRouteParams>) {
  const navigation = useNavigation();
  const environmentId = route.params.environmentId as EnvironmentId;
  const projectId = route.params.projectId as ProjectId;
  const project = useProject(scopeProjectRef(environmentId, projectId));
  const allThreads = useThreadShells();
  const separatorColor = useThemeColor("--color-separator");
  const iconColor = useThemeColor("--color-icon-muted");
  const threads = useMemo(
    () =>
      allThreads
        .filter(
          (thread) => thread.environmentId === environmentId && thread.projectId === projectId,
        )
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [allThreads, environmentId, projectId],
  );

  if (!project) {
    return (
      <View className="flex-1 items-center justify-center gap-2 bg-screen px-8">
        <Text className="text-xl font-t3-bold text-foreground">Project unavailable</Text>
        <Text className="text-center text-base text-foreground-muted">
          This project is not present in the latest environment snapshot.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-screen"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingBottom: 32 }}
    >
      <View className="px-5 pb-5 pt-4">
        <View className="flex-row items-center gap-3">
          <ProjectFavicon
            environmentId={project.environmentId}
            projectTitle={project.title}
            workspaceRoot={project.workspaceRoot}
            size={44}
            open
          />
          <View className="min-w-0 flex-1">
            <Text className="text-2xl font-t3-bold text-foreground" numberOfLines={1}>
              {project.title}
            </Text>
            <Text className="font-mono text-xs text-foreground-muted" numberOfLines={1}>
              {project.workspaceRoot}
            </Text>
          </View>
        </View>
        <Pressable
          accessibilityLabel={`Create new thread in ${project.title}`}
          accessibilityRole="button"
          className="mt-5 min-h-11 items-center justify-center rounded-[14px] bg-primary px-4"
          onPress={() =>
            navigation.navigate("NewTaskSheet", {
              screen: "NewTaskDraft",
              params: {
                environmentId: String(project.environmentId),
                projectId: String(project.id),
                title: project.title,
              },
            })
          }
          style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}
        >
          <Text className="text-base font-t3-bold text-primary-foreground">New thread</Text>
        </Pressable>
      </View>

      <View className="px-5 pb-2 pt-3">
        <Text className="text-xs font-t3-bold uppercase tracking-[0.7px] text-foreground-muted">
          Threads · {threads.length}
        </Text>
      </View>
      {threads.length === 0 ? (
        <View className="mx-5 mt-2 rounded-[16px] bg-subtle px-5 py-8">
          <Text className="text-center text-base font-t3-bold text-foreground">No threads yet</Text>
          <Text className="mt-1 text-center text-sm text-foreground-muted">
            Start work in this project with the button above.
          </Text>
        </View>
      ) : (
        <View className="mx-5 overflow-hidden rounded-[16px] bg-drawer">
          {threads.map((thread, index) => {
            const status = agentStatus(thread);
            return (
              <Pressable
                key={`${thread.environmentId}:${thread.id}`}
                accessibilityHint="Opens the thread conversation"
                accessibilityLabel={`${thread.title}, ${status.label}`}
                accessibilityRole="button"
                className="min-h-16 flex-row items-center gap-3 px-4 py-3"
                onPress={() =>
                  navigation.navigate("Thread", {
                    environmentId: thread.environmentId,
                    threadId: thread.id,
                  })
                }
                style={({ pressed }) => ({
                  opacity: pressed ? 0.65 : 1,
                  borderBottomColor: separatorColor,
                  borderBottomWidth: index === threads.length - 1 ? 0 : 1,
                })}
              >
                <SymbolView
                  name={status.symbol}
                  size={18}
                  tintColor={status.color}
                  type="monochrome"
                />
                <View className="min-w-0 flex-1">
                  <Text className="text-base font-t3-bold text-foreground" numberOfLines={1}>
                    {thread.title}
                  </Text>
                  <View className="mt-0.5 flex-row items-center gap-2">
                    <Text className="text-xs font-t3-medium" style={{ color: status.color }}>
                      {status.label}
                    </Text>
                    {thread.branch ? (
                      <Text className="font-mono text-xs text-foreground-muted" numberOfLines={1}>
                        {thread.branch}
                      </Text>
                    ) : null}
                  </View>
                </View>
                <Text className="text-xs text-foreground-tertiary">
                  {relativeTime(thread.updatedAt)}
                </Text>
                <SymbolView
                  name="chevron.right"
                  size={13}
                  tintColor={iconColor}
                  type="monochrome"
                />
              </Pressable>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

export function ProjectRouteScreen(props: StaticScreenProps<ProjectRouteParams>) {
  const navigation = useNavigation();
  const nextUiEnabled = currentUiGeneration() === "next";

  useEffect(() => {
    if (!nextUiEnabled) navigation.navigate("Home");
  }, [navigation, nextUiEnabled]);

  return nextUiEnabled ? <NextProjectRouteScreen {...props} /> : null;
}
