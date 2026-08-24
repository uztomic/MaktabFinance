// =====================================================================
//  Filiallar (TZ 4.1).
//
//  TZ 5.4.2 — bitta filial bo'lsa ham standart filial mavjud bo'ladi,
//  chunki barcha jadvalda branch_id NOT NULL. Shu tufayli maktab
//  ikkinchi bino ochganda bazani QAYTA QURISH kerak bo'lmaydi.
// =====================================================================

import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useT } from '@/i18n';
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Input, Loading,
  Modal, Notice, PageHeader, Table, Td, Th, Tr,
} from '@/ui';
import { useToast } from '@/ui/Feedback';

export default function Branches() {
  const t = useT();
  const qc = useQueryClient();
  const { mayWrite, can, profile, reload } = useAuth();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  // deno-lint-ignore no-explicit-any
  const [editing, setEditing] = useState<any>(null);

  const canEdit = mayWrite('users.manage');

  const list = useQuery({
    queryKey: ['branches-full'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('branches')
        .select('id, name, address, phone, manager_name, is_active, is_default')
        .is('deleted_at', null)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });

  const counts = useQuery({
    queryKey: ['branch-student-counts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('students')
        .select('branch_id')
        .eq('status', 'active')
        .is('deleted_at', null);
      if (error) throw error;
      const m = new Map<string, number>();
      for (const s of data ?? []) {
        m.set(s.branch_id, (m.get(s.branch_id) ?? 0) + 1);
      }
      return m;
    },
  });

  /**
   * Bitta mutatsiya ham qo'shish, ham tahrirlash uchun: maydonlar bir
   * xil, farq faqat `id` bor-yo'qligida. Ikkita alohida mutatsiya
   * yozilsa ular vaqt o'tib bir-biridan uzilib qoladi.
   */
  const save = useMutation({
    mutationFn: async (f: {
      id?: string;
      name: string; address: string; phone: string; manager_name: string;
      is_active: boolean;
    }) => {
      const payload = {
        name: f.name.trim(),
        address: f.address.trim() || null,
        phone: f.phone.trim() || null,
        manager_name: f.manager_name.trim() || null,
        is_active: f.is_active,
      };
      if (f.id) {
        const { error } = await supabase.from('branches')
          .update(payload).eq('id', f.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('branches').insert({
          school_id: profile!.school_id,
          ...payload,
        });
        if (error) throw error;
      }
    },
    onSuccess: async () => {
      qc.invalidateQueries({ queryKey: ['branches-full'] });
      // Nom o'zgarsa yoki yangi filial qo'shilsa yon paneldagi
      // tanlov ham yangilanishi kerak.
      await reload();
      toast.ok(t('ux.saved'));
      setAdding(false);
      setEditing(null);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (!can('users.manage')) {
    return <Notice tone="danger">{t('common.noAccess')}</Notice>;
  }
  if (list.isLoading) return <Loading />;
  if (list.error) {
    return <ErrorState message={(list.error as Error).message}
                       onRetry={() => list.refetch()} />;
  }

  return (
    <>
      <PageHeader
        title={t('branches.title')}
        subtitle={t('common.showing', { count: list.data?.length ?? 0 })}
        actions={canEdit && (
          <Button variant="primary" onClick={() => setAdding(true)}>
            {t('branches.add')}
          </Button>
        )}
      />

      <Card padded={false}>
        {(list.data?.length ?? 0) === 0 ? <EmptyState /> : (
          <Table>
            <thead>
              <tr>
                <Th>{t('common.name')}</Th>
                <Th>{t('common.address')}</Th>
                <Th>{t('branches.manager')}</Th>
                <Th>{t('common.phone')}</Th>
                <Th align="right">{t('branches.students')}</Th>
                <Th>{t('common.status')}</Th>
                <Th align="right">{t('common.actions')}</Th>
              </tr>
            </thead>
            <tbody>
              {list.data!.map((b) => (
                <Tr key={b.id}>
                  <Td>
                    <span className="font-medium">{b.name}</span>
                    {b.is_default && (
                      <span className="ml-1.5">
                        <Badge tone="brand">{t('branches.isDefault')}</Badge>
                      </span>
                    )}
                  </Td>
                  <Td className="text-[var(--text-muted)]">{b.address ?? '—'}</Td>
                  <Td className="text-[var(--text-muted)]">{b.manager_name ?? '—'}</Td>
                  <Td mono className="text-[var(--text-muted)]">{b.phone ?? '—'}</Td>
                  <Td align="right" mono>{counts.data?.get(b.id) ?? 0}</Td>
                  <Td>
                    <Badge tone={b.is_active ? 'ok' : 'neutral'}>
                      {b.is_active ? t('common.active') : t('common.inactive')}
                    </Badge>
                  </Td>
                  <Td align="right">
                    {canEdit && (
                      <Button size="sm" onClick={() => setEditing(b)}>
                        {t('common.edit')}
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {(adding || editing) && (
        <Modal
          open
          title={editing ? t('branches.edit') : t('branches.add')}
          onClose={() => { setAdding(false); setEditing(null); }}
          footer={
            <>
              <Button onClick={() => { setAdding(false); setEditing(null); }}>
                {t('common.cancel')}
              </Button>
              <Button variant="primary" form="branch-form" type="submit"
                      disabled={save.isPending}>
                {save.isPending ? t('common.saving') : t('common.save')}
              </Button>
            </>
          }
        >
          <BranchForm
            key={editing?.id ?? 'new'}
            existing={editing}
            onSubmit={(f) => save.mutate(f)}
            error={save.error ? (save.error as Error).message : null}
          />
        </Modal>
      )}
    </>
  );
}

function BranchForm({
  existing, onSubmit, error,
}: {
  // deno-lint-ignore no-explicit-any
  existing: any;
  // deno-lint-ignore no-explicit-any
  onSubmit: (f: any) => void;
  error: string | null;
}) {
  const t = useT();
  const [f, setF] = useState({
    id: existing?.id as string | undefined,
    name: existing?.name ?? '',
    address: existing?.address ?? '',
    phone: existing?.phone ?? '',
    manager_name: existing?.manager_name ?? '',
    is_active: existing?.is_active ?? true,
  });
  const set = (k: string, v: string | boolean) =>
    setF((p) => ({ ...p, [k]: v }));

  return (
    <form
      id="branch-form"
      onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }}
      className="space-y-3"
    >
      <Field label={t('common.name')} required>
        <Input value={f.name} onChange={(e) => set('name', e.target.value)}
               autoFocus required />
      </Field>
      <Field label={t('common.address')}>
        <Input value={f.address} onChange={(e) => set('address', e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('branches.manager')}>
          <Input value={f.manager_name}
                 onChange={(e) => set('manager_name', e.target.value)} />
        </Field>
        <Field label={t('common.phone')}>
          <Input value={f.phone} onChange={(e) => set('phone', e.target.value)}
                 inputMode="tel" />
        </Field>
      </div>

      {existing && (
        <>
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={f.is_active}
              onChange={(e) => set('is_active', e.target.checked)}
              className="h-4 w-4"
              disabled={existing.is_default}
            />
            {t('common.active')}
          </label>
          {existing.is_default && (
            <Notice tone="neutral">{t('branches.defaultLocked')}</Notice>
          )}
          {!f.is_active && !existing.is_default && (
            <Notice tone="warn">{t('branches.deactivateHint')}</Notice>
          )}
        </>
      )}

      {error && <Notice tone="danger">{error}</Notice>}
    </form>
  );
}
