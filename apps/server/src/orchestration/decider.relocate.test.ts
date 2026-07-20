import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const now = "2026-01-01T00:00:00.000Z";
const sourceId = ProjectId.make("source-project");
const destinationId = ProjectId.make("destination-project");
const sourceThreadId = ThreadId.make("source-thread");

function event(
  sequence: number,
  input: Pick<OrchestrationEvent, "aggregateKind" | "aggregateId" | "type" | "payload">,
): OrchestrationEvent {
  return {
    sequence,
    eventId: EventId.make(`event-${sequence}`),
    occurredAt: now,
    commandId: CommandId.make(`command-${sequence}`),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    ...input,
  } as OrchestrationEvent;
}

const seedReadModel = Effect.fn("seedRelocateReadModel")(function* () {
  let readModel = createEmptyReadModel(now);
  for (const nextEvent of [
    event(1, {
      aggregateKind: "project",
      aggregateId: sourceId,
      type: "project.created",
      payload: {
        projectId: sourceId,
        title: "Source",
        workspaceRoot: "/work/source",
        defaultModelSelection: null,
        scripts: [
          {
            id: "source-only",
            name: "Source only",
            command: "source",
            icon: "play",
            runOnWorktreeCreate: false,
          },
          {
            id: "shared",
            name: "Source shared",
            command: "source-shared",
            icon: "play",
            runOnWorktreeCreate: false,
          },
        ],
        createdAt: now,
        updatedAt: now,
      },
    }),
    event(2, {
      aggregateKind: "project",
      aggregateId: destinationId,
      type: "project.created",
      payload: {
        projectId: destinationId,
        title: "Destination",
        workspaceRoot: "/work/destination",
        defaultModelSelection: null,
        scripts: [
          {
            id: "shared",
            name: "Destination shared",
            command: "destination-shared",
            icon: "play",
            runOnWorktreeCreate: false,
          },
        ],
        createdAt: now,
        updatedAt: now,
      },
    }),
    event(3, {
      aggregateKind: "thread",
      aggregateId: sourceThreadId,
      type: "thread.created",
      payload: {
        threadId: sourceThreadId,
        projectId: sourceId,
        title: "Preserved thread",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4",
        },
        runtimeMode: "full-access",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        branch: null,
        worktreePath: null,
        createdAt: now,
        updatedAt: now,
      },
    }),
    event(4, {
      aggregateKind: "thread",
      aggregateId: sourceThreadId,
      type: "thread.archived",
      payload: {
        threadId: sourceThreadId,
        archivedAt: now,
        updatedAt: now,
      },
    }),
  ]) {
    readModel = yield* projectEvent(readModel, nextEvent);
  }
  return readModel;
});

function relocateCommand(input: { mergeOnConflict: boolean; workspaceRoot: string }) {
  return {
    type: "project.relocate" as const,
    commandId: CommandId.make("relocate-command"),
    projectId: sourceId,
    ...input,
  };
}

it.layer(NodeServices.layer)("project relocation decider", (it) => {
  it.effect("moves a project to an unused workspace root", () =>
    Effect.gen(function* () {
      const readModel = yield* seedReadModel();
      const result = yield* decideOrchestrationCommand({
        command: relocateCommand({ mergeOnConflict: false, workspaceRoot: "/work/moved" }),
        readModel,
      });
      const events = Array.isArray(result) ? result : [result];

      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("project.meta-updated");
      expect(events[0]?.payload).toMatchObject({
        projectId: sourceId,
        workspaceRoot: "/work/moved",
      });
    }),
  );

  it.effect("rejects an occupied destination without explicit merge permission", () =>
    Effect.gen(function* () {
      const readModel = yield* seedReadModel();
      const error = yield* Effect.flip(
        decideOrchestrationCommand({
          command: relocateCommand({
            mergeOnConflict: false,
            workspaceRoot: "/work/destination",
          }),
          readModel,
        }),
      );
      expect(error.message).toContain("Retry with mergeOnConflict=true");
    }),
  );

  it.effect("reassigns archived threads, unions scripts, and retires the source", () =>
    Effect.gen(function* () {
      let readModel = yield* seedReadModel();
      const result = yield* decideOrchestrationCommand({
        command: relocateCommand({
          mergeOnConflict: true,
          workspaceRoot: "/work/destination",
        }),
        readModel,
      });
      const events = Array.isArray(result) ? result : [result];

      expect(events.map((entry) => entry.type)).toEqual([
        "project.meta-updated",
        "thread.project-updated",
        "project.deleted",
      ]);

      let sequence = readModel.snapshotSequence;
      for (const nextEvent of events) {
        sequence += 1;
        readModel = yield* projectEvent(readModel, { ...nextEvent, sequence });
      }

      const destination = readModel.projects.find((project) => project.id === destinationId);
      const source = readModel.projects.find((project) => project.id === sourceId);
      const thread = readModel.threads.find((entry) => entry.id === sourceThreadId);
      expect(destination?.title).toBe("Destination");
      expect(destination?.scripts.map((script) => [script.id, script.command])).toEqual([
        ["shared", "destination-shared"],
        ["source-only", "source"],
      ]);
      expect(source?.deletedAt).not.toBeNull();
      expect(thread?.projectId).toBe(destinationId);
      expect(thread?.archivedAt).toBe(now);
    }),
  );

  it.effect("rejects relocation while a source thread has a running turn", () =>
    Effect.gen(function* () {
      const seeded = yield* seedReadModel();
      const readModel: OrchestrationReadModel = {
        ...seeded,
        threads: seeded.threads.map((thread) =>
          thread.id === sourceThreadId
            ? {
                ...thread,
                latestTurn: {
                  turnId: TurnId.make("running-turn"),
                  state: "running",
                  requestedAt: now,
                  startedAt: now,
                  completedAt: null,
                  assistantMessageId: null,
                },
              }
            : thread,
        ),
      };
      const error = yield* Effect.flip(
        decideOrchestrationCommand({
          command: relocateCommand({ mergeOnConflict: false, workspaceRoot: "/work/moved" }),
          readModel,
        }),
      );
      expect(error.message).toContain("running turn or pending interaction");
    }),
  );
});
