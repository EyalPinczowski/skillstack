import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  DayOverride,
  ImportBody,
  LegalDocument,
  LogRequest,
  Me,
  PreviewRequest,
  TaskPatch,
  WeekPattern,
} from './client';
import { useApi } from './context';

/**
 * The one data layer (spec 12.3): components never call the client or fetch directly, they use the
 * hooks below. Later features add their hooks here, next to these.
 */
export const meKey = ['me'] as const;

// Mutations use networkMode "always": offline they fail at once with a network error the form can
// show, instead of waiting silently for a connection.
const mutationDefaults = { networkMode: 'always' } as const;

/** The signed-in account. A 403 here means the email is not on the allowlist. */
export function useMe() {
  const api = useApi();
  return useQuery({ queryKey: meKey, queryFn: ({ signal }) => api.getMe(signal) });
}

export function useUpdateDisplayName() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    ...mutationDefaults,
    mutationFn: (displayName: string | null) => api.updateDisplayName(displayName),
    onSuccess: (me: Me) => queryClient.setQueryData(meKey, me),
  });
}

/** Accepts each given document at the version the API reported as current. */
export function useAcceptLegal() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    ...mutationDefaults,
    mutationFn: async (documents: { document: LegalDocument; version: string }[]) => {
      let me: Me | undefined;
      for (const { document, version } of documents) {
        me = await api.acceptLegal(document, version);
      }
      return me!;
    },
    onSuccess: (me: Me) => queryClient.setQueryData(meKey, me),
  });
}

export function useExportData() {
  const api = useApi();
  return useMutation({ ...mutationDefaults, mutationFn: () => api.exportData() });
}

export function useDeleteAccount() {
  const api = useApi();
  return useMutation({
    ...mutationDefaults,
    mutationFn: (confirmation: string) => api.deleteAccount(confirmation),
  });
}

// Plans, schedule, tasks and progress (v0.1).
export const plansKey = ['plans'] as const;
export const planKey = (planId: string) => ['plan', planId] as const;
export const tasksKey = (planId: string) => ['tasks', planId] as const;
export const scheduleKey = (planId: string) => ['schedule', planId] as const;
export const progressKey = (planId: string) => ['progress', planId] as const;

export function usePlans() {
  const api = useApi();
  return useQuery({ queryKey: plansKey, queryFn: ({ signal }) => api.listPlans(signal) });
}

/** The plan with its week pattern and day overrides. */
export function usePlan(planId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: planKey(planId ?? ''),
    queryFn: ({ signal }) => api.getPlan(planId!, signal),
    enabled: !!planId,
  });
}

export function useTasks(planId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: tasksKey(planId ?? ''),
    queryFn: ({ signal }) => api.listTasks(planId!, signal),
    enabled: !!planId,
  });
}

export function useSchedule(planId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: scheduleKey(planId ?? ''),
    queryFn: ({ signal }) => api.getSchedule(planId!, signal),
    enabled: !!planId,
  });
}

export function useProgress(planId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: progressKey(planId ?? ''),
    queryFn: ({ signal }) => api.getProgress(planId!, signal),
    enabled: !!planId,
  });
}

/** Refreshes everything that depends on task hours, task status or the time settings. */
function useInvalidatePlanData() {
  const queryClient = useQueryClient();
  return (planId: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: tasksKey(planId) }),
      queryClient.invalidateQueries({ queryKey: progressKey(planId) }),
      queryClient.invalidateQueries({ queryKey: scheduleKey(planId) }),
      queryClient.invalidateQueries({ queryKey: planKey(planId) }),
      queryClient.invalidateQueries({ queryKey: plansKey }),
    ]);
}

/** Imports a plan file. The caller supplies the client-generated id, which makes a retry safe. */
export function useImportPlan() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    ...mutationDefaults,
    mutationFn: (body: ImportBody) => api.importPlan(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: plansKey }),
  });
}

export function useAddLog(planId: string) {
  const api = useApi();
  const invalidate = useInvalidatePlanData();
  return useMutation({
    ...mutationDefaults,
    mutationFn: ({ taskId, log }: { taskId: string; log: LogRequest }) =>
      api.addLog(planId, taskId, log),
    onSuccess: () => void invalidate(planId),
  });
}

/** An explicit user action on one task. The app never calls these on its own. */
export function useTaskAction(planId: string, action: 'complete' | 'skip' | 'reopen') {
  const api = useApi();
  const invalidate = useInvalidatePlanData();
  return useMutation({
    ...mutationDefaults,
    mutationFn: (taskId: string) =>
      action === 'complete'
        ? api.completeTask(planId, taskId)
        : action === 'skip'
          ? api.skipTask(planId, taskId)
          : api.reopenTask(planId, taskId),
    onSuccess: () => void invalidate(planId),
  });
}

export function usePatchTask(planId: string) {
  const api = useApi();
  const invalidate = useInvalidatePlanData();
  return useMutation({
    ...mutationDefaults,
    mutationFn: ({ taskId, patch }: { taskId: string; patch: TaskPatch }) =>
      api.patchTask(planId, taskId, patch),
    onSuccess: () => void invalidate(planId),
  });
}

/** Computes what a time-settings change would do. Saves nothing. */
export function usePreviewSchedule(planId: string) {
  const api = useApi();
  return useMutation({
    ...mutationDefaults,
    mutationFn: (request: PreviewRequest) => api.previewSchedule(planId, request),
  });
}

export interface TimeSettingsChange {
  pattern?: WeekPattern;
  upsertOverrides: DayOverride[];
  removeOverrideDates: string[];
}

/** Saves an approved time-settings change with the PUT endpoints, one after the other. */
export function useSaveTimeSettings(planId: string) {
  const api = useApi();
  const invalidate = useInvalidatePlanData();
  return useMutation({
    ...mutationDefaults,
    mutationFn: async (change: TimeSettingsChange) => {
      if (change.pattern) await api.putWeekPattern(planId, change.pattern);
      for (const { date, ...rest } of change.upsertOverrides) {
        await api.putDayOverride(planId, date, rest);
      }
      for (const date of change.removeOverrideDates) await api.deleteDayOverride(planId, date);
    },
    // Even a half-finished save changes the plan, so refresh on failure too.
    onSettled: () => invalidate(planId),
  });
}
