'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ImageUp, Trash2, TriangleAlert } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { fmtDateTime } from '@/lib/utils';
import { Button, Card, CardBody, CardHeader } from '@/components/ui/primitives';
import { logoSrc, useBranding, type BrandingInfo } from './brand-mark';

const ACCEPT = ['image/png', 'image/jpeg', 'image/webp'];
/** Kept under the server's 64 KB cap with room to spare. */
const TARGET_BYTES = 60 * 1024;
const MAX_EDGE = 256;

const bytesOf = (dataUrl: string) => Math.floor(((dataUrl.length - dataUrl.indexOf(',') - 1) * 3) / 4);

/**
 * Resize in the browser before upload.
 *
 * The mark is shown at 32–44px, so 256px on the long edge is ample even on a
 * high-density screen. PNG first, to keep transparency; WebP if PNG is too
 * heavy (photographic logos); refused only if neither fits.
 */
async function prepare(file: File): Promise<string> {
  if (!ACCEPT.includes(file.type)) {
    throw new Error('Use a PNG, JPEG or WebP image. SVG is not accepted.');
  }
  if (file.size > 8 * 1024 * 1024) throw new Error('That file is over 8 MB — export a smaller logo and try again.');

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser could not process the image.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const png = canvas.toDataURL('image/png');
  if (bytesOf(png) <= TARGET_BYTES) return png;
  for (const q of [0.92, 0.85, 0.75]) {
    const webp = canvas.toDataURL('image/webp', q);
    if (webp.startsWith('data:image/webp') && bytesOf(webp) <= TARGET_BYTES) return webp;
  }
  throw new Error('This image is too detailed to store as a logo. Try a simpler or smaller version.');
}

/**
 * Brand logo — replaces the D·D monogram in the navigation and on sign-in.
 */
export function BrandLogoCard({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const { data } = useBranding();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [pending, setPending] = React.useState<string | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);

  const current = data?.logo ?? null;
  const shown = pending ?? (current ? logoSrc(current.updatedAt) : null);

  const save = useMutation({
    mutationFn: (dataUrl: string) => api.put<BrandingInfo>('/branding/logo', { dataUrl }),
    onSuccess: (res) => {
      qc.setQueryData(['branding'], res);
      setPending(null);
      toast.success('Logo updated');
    },
    onError: (err) => setProblem(err instanceof ApiError ? err.message : 'The logo could not be saved.'),
  });

  const remove = useMutation({
    mutationFn: () => api.del<BrandingInfo>('/branding/logo'),
    onSuccess: (res) => {
      qc.setQueryData(['branding'], res);
      setPending(null);
      toast.success('Logo removed — showing the D·D monogram');
    },
    onError: (err) => setProblem(err instanceof ApiError ? err.message : 'The logo could not be removed.'),
  });

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // so choosing the same file again still fires
    if (!file) return;
    setProblem(null);
    try {
      setPending(await prepare(file));
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That image could not be read.');
    }
  };

  const busy = save.isPending || remove.isPending;

  return (
    <Card id="brand-logo">
      <CardHeader
        title="Brand logo"
        description="Replaces the D·D monogram in the navigation and on the sign-in screen, for everyone."
      />
      <CardBody>
        <div className="flex flex-wrap items-center gap-6">
          {/* How it reads in each theme. */}
          <div className="flex items-center gap-3">
            {(['light', 'dark'] as const).map((tone) => (
              <div
                key={tone}
                className={
                  'grid size-[88px] place-items-center rounded-2xl border ' +
                  (tone === 'light' ? 'border-black/10 bg-[#F3F0EA]' : 'border-white/15 bg-[#101621]')
                }
                title={tone === 'light' ? 'Day theme' : 'Night theme'}
              >
                {shown ? (
                  <span className="grid size-11 place-items-center overflow-hidden rounded-[12px] bg-white p-1 ring-1 ring-inset ring-black/[0.06]">
                    {/* eslint-disable-next-line @next/next/no-img-element -- local preview of a data URL */}
                    <img src={shown} alt={tone === 'light' ? 'Logo preview, day theme' : 'Logo preview, night theme'} className="size-full object-contain" />
                  </span>
                ) : (
                  <span
                    className={
                      'grid size-11 place-items-center rounded-[12px] text-[14px] font-bold tracking-tighter ' +
                      (tone === 'light' ? 'bg-[#182231] text-[#F3F0EA]' : 'bg-[#F5F7FB] text-[#101621]')
                    }
                  >
                    D·D
                  </span>
                )}
              </div>
            ))}
          </div>

          <div className="min-w-[220px] flex-1 space-y-2">
            <p className="text-[13.5px] text-ink">
              {pending
                ? 'Preview — not saved yet.'
                : current
                  ? <>Custom logo · updated {fmtDateTime(current.updatedAt)}</>
                  : 'Showing the D·D monogram.'}
            </p>
            <p className="text-[13px] text-ink-muted">
              PNG, JPEG or WebP. A square mark with a transparent background works best; it is resized to 256 px.
            </p>

            {problem ? (
              <p role="alert" className="flex items-start gap-2 rounded-lg border border-danger/35 bg-danger-soft px-3 py-2 text-[13px] text-ink">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" /> {problem}
              </p>
            ) : null}

            {canEdit ? (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <input
                  ref={inputRef}
                  type="file"
                  accept={ACCEPT.join(',')}
                  className="sr-only"
                  onChange={onFile}
                  aria-label="Choose a logo image"
                />
                {pending ? (
                  <>
                    <Button variant="primary" loading={save.isPending} disabled={busy} onClick={() => save.mutate(pending)}>
                      Save logo
                    </Button>
                    <Button variant="ghost" disabled={busy} onClick={() => { setPending(null); setProblem(null); }}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button variant="default" disabled={busy} onClick={() => inputRef.current?.click()}>
                    <ImageUp /> {current ? 'Replace logo' : 'Upload logo'}
                  </Button>
                )}
                {current && !pending ? (
                  <Button variant="danger" loading={remove.isPending} disabled={busy} onClick={() => remove.mutate()}>
                    <Trash2 /> Use D·D
                  </Button>
                ) : null}
              </div>
            ) : (
              <p className="text-[12.5px] text-ink-subtle">Changing the logo needs the “manage settings” permission.</p>
            )}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
