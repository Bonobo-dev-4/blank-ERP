'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './primitives';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  title,
  description,
  footer,
  children,
  className,
  wide,
}: {
  title: string;
  description?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  wide?: boolean;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[var(--glass-scrim)] backdrop-blur-[6px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 flex max-h-[92vh] w-[calc(100vw-1.5rem)] -translate-x-1/2 -translate-y-1/2',
          'glass-modal flex-col overflow-hidden rounded-3xl',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          wide ? 'max-w-5xl' : 'max-w-lg',
          className,
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <DialogPrimitive.Title className="text-[16px] font-semibold tracking-tight text-ink">{title}</DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-0.5 text-[12.5px] text-ink-muted">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          <DialogPrimitive.Close asChild>
            <Button variant="ghost" size="icon" aria-label="Close">
              <X />
            </Button>
          </DialogPrimitive.Close>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-line bg-surface-muted px-5 py-3">
            {footer}
          </div>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/**
 * Confirmation for an action that creates or destroys value.
 *
 * `consequence` is required rather than optional: the specification asks for
 * elevated actions to be deliberate, and the way to make them deliberate is to
 * state in words what will happen, not to add a second button.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  consequence,
  confirmLabel = 'Confirm',
  tone = 'primary',
  loading,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  consequence: React.ReactNode;
  confirmLabel?: string;
  tone?: 'primary' | 'danger' | 'elevated';
  loading?: boolean;
  onConfirm: () => void;
  children?: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={title}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="default" disabled={loading}>
                Cancel
              </Button>
            </DialogClose>
            <Button variant={tone} onClick={onConfirm} loading={loading}>
              {confirmLabel}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="rounded border border-line bg-surface-muted px-3 py-2 text-[12.5px] text-ink">
            {consequence}
          </div>
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
}
