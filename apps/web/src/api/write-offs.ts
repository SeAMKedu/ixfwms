import type { WriteOffRow } from '@ixfwms/domain';
import { useQuery } from '@tanstack/react-query';
import { useSession } from '../auth/session';
import { api } from './client';

/** Tools and devices with purchase details or removed from use; for members. */
export const useWriteOffs = () => {
  const { can } = useSession();
  return useQuery({
    queryKey: ['write-offs'],
    queryFn: () => api<WriteOffRow[]>('/api/write-offs'),
    enabled: can('inventory'),
  });
};
