'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

export interface BrandingInfo {
  logo: { mime: string; updatedAt: string } | null;
}

/**
 * Whether the organisation has uploaded a logo, and when it last changed.
 *
 * Public on the API side, so the sign-in screen can use it too. The image URL
 * carries the change time, so a new upload shows at once while an unchanged
 * logo stays cached.
 */
export function useBranding() {
  return useQuery({
    queryKey: ['branding'],
    queryFn: () => api.get<BrandingInfo>('/branding'),
    staleTime: 5 * 60_000,
  });
}

export const logoSrc = (updatedAt: string) => `/api/branding/logo?v=${encodeURIComponent(updatedAt)}`;

/**
 * The brand mark: the uploaded logo when there is one, otherwise the D·D
 * monogram. A logo sits on a white tile so a dark or coloured mark reads in
 * both themes; if the image fails to load, the monogram takes its place.
 */
export function BrandMark({ size = 32, className }: { size?: number; className?: string }) {
  const { data } = useBranding();
  const [failed, setFailed] = React.useState(false);
  const logo = data?.logo ?? null;

  React.useEffect(() => { setFailed(false); }, [logo?.updatedAt]);

  const radius = Math.round(size * 0.28);

  if (logo && !failed) {
    return (
      <span
        className={cn('grid shrink-0 place-items-center overflow-hidden bg-white ring-1 ring-inset ring-black/[0.06]', className)}
        style={{ width: size, height: size, borderRadius: radius, padding: Math.max(2, Math.round(size * 0.1)) }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a tiny, already-sized brand image */}
        <img
          src={logoSrc(logo.updatedAt)}
          alt="DASH AND DOT logo"
          className="size-full object-contain"
          onError={() => setFailed(true)}
          draggable={false}
        />
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn('grid shrink-0 place-items-center bg-ink font-bold tracking-tighter text-canvas', className)}
      style={{ width: size, height: size, borderRadius: radius, fontSize: Math.round(size * 0.32) }}
    >
      D·D
    </span>
  );
}
