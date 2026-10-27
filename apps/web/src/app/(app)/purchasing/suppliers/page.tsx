'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { createSupplierRequest } from '@dnd/contracts';
import { api, ApiError } from '@/lib/api';
import { useListQuery, useListState, paginationProps } from '@/lib/hooks';
import { Button, ErrorPanel, Field, Input, PageHeader, QtyInput, StatusBadge, Textarea } from '@/components/ui/primitives';
import { CsvImportButton } from '@/components/app/csv-import';
import { CodeCell, DataTable, StackedCell } from '@/components/ui/data-table';
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog';
import { useAuth } from '@/components/app/auth-context';

interface SupplierRow {
  id: string; supplierCode: string; name: string; contactPerson: string | null;
  email: string | null; phone: string | null; city: string | null; state: string | null;
  gstin: string | null; paymentTerms: string | null; leadTimeDays: number; status: string;
  _count: { purchaseOrders: number; materials: number; receipts: number };
}

export default function SuppliersPage() {
  const { can } = useAuth();
  const state = useListState({ sortBy: 'name', sortDir: 'asc' });
  const { data, isLoading, isFetching, error, refetch } = useListQuery<SupplierRow>(
    'suppliers', '/suppliers', state,
  );
  const [creating, setCreating] = React.useState(false);

  const columns = React.useMemo<ColumnDef<SupplierRow, unknown>[]>(
    () => [
      { id: 'supplierCode', header: 'Code', accessorKey: 'supplierCode',
        cell: ({ row }) => <CodeCell>{row.original.supplierCode}</CodeCell> },
      { id: 'name', header: 'Supplier', accessorKey: 'name',
        cell: ({ row }) => (
          <StackedCell
            primary={row.original.name}
            secondary={[row.original.city, row.original.state].filter(Boolean).join(', ')}
          />
        ),
      },
      { id: 'contact', header: 'Contact', accessorFn: (r) => r.contactPerson ?? '',
        cell: ({ row }) => (
          <StackedCell
            primary={row.original.contactPerson ?? '-'}
            secondary={row.original.phone ?? row.original.email ?? undefined}
          />
        ),
      },
      { id: 'gstin', header: 'GSTIN', accessorKey: 'gstin',
        cell: ({ row }) => (row.original.gstin ? <CodeCell>{row.original.gstin}</CodeCell> : '-') },
      { id: 'leadTimeDays', header: 'Lead time', accessorKey: 'leadTimeDays',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => `${row.original.leadTimeDays}d` },
      { id: 'materials', header: 'Materials', accessorFn: (r) => r._count.materials,
        meta: { align: 'right', numeric: true } },
      { id: 'purchaseOrders', header: 'POs', accessorFn: (r) => r._count.purchaseOrders,
        meta: { align: 'right', numeric: true } },
      { id: 'paymentTerms', header: 'Terms', accessorKey: 'paymentTerms',
        cell: ({ row }) => <span className="text-ink-muted">{row.original.paymentTerms ?? '-'}</span> },
      { id: 'status', header: 'Status', accessorKey: 'status',
        cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    ],
    [],
  );

  return (
    <div>
      <PageHeader
        title="Vendor Management"
        description="Raw material suppliers. Lead time feeds the MRP arrival estimates, so keeping it accurate is what makes shortage warnings trustworthy."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <CsvImportButton type="suppliers" invalidate={['suppliers']} />
            {can('purchasing.manage_suppliers') ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus />
              New supplier
            </Button>
            ) : null}
          </div>
        }
      />
      {error ? <ErrorPanel error={error} onRetry={() => void refetch()} className="mb-3" /> : null}
      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isLoading}
        isFetching={isFetching}
        pagination={paginationProps(data, state)}
        search={{ value: state.search, onChange: state.setSearch, placeholder: 'Code, name, contact, city, GSTIN' }}
        exportFileName="suppliers"
        emptyTitle="No suppliers"
      />
      {creating ? <SupplierDialog open={creating} onOpenChange={setCreating} onSaved={() => void refetch()} /> : null}
    </div>
  );
}

function SupplierDialog({
  open, onOpenChange, onSaved,
}: { open: boolean; onOpenChange: (v: boolean) => void; onSaved: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = React.useState({
    supplierCode: '', name: '', contactPerson: '', email: '', phone: '',
    addressLine1: '', city: '', state: '', pincode: '', gstin: '',
    paymentTerms: '', leadTimeDays: '0', notes: '',
  });
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [error, setError] = React.useState<unknown>(null);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        leadTimeDays: Number(form.leadTimeDays || 0),
        email: form.email || null,
        contactPerson: form.contactPerson || null,
        phone: form.phone || null,
        addressLine1: form.addressLine1 || null,
        city: form.city || null,
        state: form.state || null,
        pincode: form.pincode || null,
        gstin: form.gstin || null,
        paymentTerms: form.paymentTerms || null,
        notes: form.notes || null,
      };
      const parsed = createSupplierRequest.safeParse(payload);
      if (!parsed.success) {
        const errs: Record<string, string[]> = {};
        for (const i of parsed.error.issues) (errs[i.path.join('.') || '_root'] ??= []).push(i.message);
        setFieldErrors(errs);
        throw new Error('Please correct the highlighted fields');
      }
      setFieldErrors({});
      return api.post('/suppliers', parsed.data);
    },
    onSuccess: () => {
      toast.success(`Supplier ${form.supplierCode} created`);
      void queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      onSaved();
      onOpenChange(false);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fieldErrors) setFieldErrors(e.fieldErrors);
      setError(e);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        wide
        title="New supplier"
        footer={
          <>
            <DialogClose asChild><Button variant="default">Cancel</Button></DialogClose>
            <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending}>Create supplier</Button>
          </>
        }
      >
        <div className="space-y-3">
          {error ? <ErrorPanel error={error} /> : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Supplier code" required error={fieldErrors.supplierCode}>
              <Input value={form.supplierCode} onChange={(e) => set('supplierCode', e.target.value.toUpperCase())}
                placeholder="SUP-0002" className="font-mono uppercase" />
            </Field>
            <Field label="Name" required className="sm:col-span-2" error={fieldErrors.name}>
              <Input value={form.name} onChange={(e) => set('name', e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Contact person"><Input value={form.contactPerson} onChange={(e) => set('contactPerson', e.target.value)} /></Field>
            <Field label="Phone"><Input value={form.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
            <Field label="Email" error={fieldErrors.email}><Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></Field>
          </div>
          <Field label="Address"><Input value={form.addressLine1} onChange={(e) => set('addressLine1', e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="City"><Input value={form.city} onChange={(e) => set('city', e.target.value)} /></Field>
            <Field label="State"><Input value={form.state} onChange={(e) => set('state', e.target.value)} /></Field>
            <Field label="Pincode"><Input value={form.pincode} onChange={(e) => set('pincode', e.target.value)} /></Field>
            <Field label="GSTIN"><Input value={form.gstin} onChange={(e) => set('gstin', e.target.value.toUpperCase())} className="font-mono uppercase" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Payment terms"><Input value={form.paymentTerms} onChange={(e) => set('paymentTerms', e.target.value)} placeholder="30 days" /></Field>
            <Field label="Lead time" hint="days"><QtyInput value={form.leadTimeDays} onChange={(e) => set('leadTimeDays', e.target.value.replace(/\D/g, ''))} /></Field>
          </div>
          <Field label="Notes"><Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} /></Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}
