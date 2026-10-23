'use client';

import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { ApiError } from '@/lib/api';

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Stock figures go stale quickly on a live shop floor, but not so
            // quickly that every tab switch refetches the whole dashboard.
            staleTime: 15_000,
            refetchOnWindowFocus: true,
            retry: (failureCount, error) => {
              // Never retry a rejected business rule: the answer will not
              // change, and a retried mutation is how duplicates happen.
              if (error instanceof ApiError && !error.isRetryable) return false;
              return failureCount < 2;
            },
          },
          mutations: { retry: false },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: { fontSize: '12.5px', borderRadius: '6px' },
          className: 'border border-line',
        }}
      />
    </QueryClientProvider>
  );
}
