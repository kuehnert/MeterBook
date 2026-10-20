import { Image, Skeleton } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { blob } from '../lib/api';

/** Lädt ein Foto mit Anmeldung (Header statt Token in der URL) und zeigt es an. */
export function AuthImage({ photoId, thumb, mah, w, h, onClick }: { photoId: string; thumb?: boolean; mah?: number; w?: number; h?: number; onClick?: () => void }) {
  const q = useQuery({
    queryKey: ['photo', photoId, thumb ? 'thumb' : 'full'],
    queryFn: () => blob(`/photos/${photoId}${thumb ? '?size=thumb' : ''}`),
    staleTime: Infinity,
  });
  const url = useMemo(() => (q.data ? URL.createObjectURL(q.data) : null), [q.data]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  if (!url) return <Skeleton h={h ?? mah ?? 120} w={w} radius="md" />;
  return <Image src={url} radius="md" mah={mah} w={w} h={h} fit="contain" onClick={onClick} style={onClick ? { cursor: 'zoom-in' } : undefined} />;
}
