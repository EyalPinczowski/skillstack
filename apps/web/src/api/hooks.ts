import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LegalDocument, Me } from './client';
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
