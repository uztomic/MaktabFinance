// =====================================================================
//  Xarajatlar (TZ 4.10).
//
//  TZ 4.10.2 — o'qituvchilar oyligi bu yerga QO'LDA KIRITILMAYDI:
//  u tasdiqlangan oylik hisobidan avtomatik tushadi. Bunday yozuv
//  ro'yxatda alohida belgilanadi va tahrirlanmaydi (baza triggeri
//  ham to'xtatadi).
//
//  TZ 4.10.1 — kategoriyalar ro'yxati maktab tomonidan kengaytiriladi.
// =====================================================================

import { type FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n, useT } from '@/i18n';
import { date, isoDate, money } from '@/lib/format';
import { exportTable } from '@/lib/export';
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Input, Loading,
  Modal, MoneyInput, Notice, PageHeader, Select, Table, Td, Th, Tr,
} from '@/ui';
import { useConfirm, useToast } from '@/ui/Feedback';

export default function Expenses() {
  const t = useT();
  const { lang } = useI18n();
  const qc = useQueryClient();
  const { branchId, branches, can, mayWrite, profile } = useAuth();

  const monthStart = isoDate(
    new Date(new Date().getFullYear(), new Date().getMonth(), 1));

  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(isoDate());
  const [categoryId, setCategoryId] = useState('');
  const toast = useToast();
  const confirmDialog = useConfirm();
  const [adding, setAdding] = useState(false);
  const [addingCategory, setAddingCategory] = useState(false);
  // deno-lint-ignore no-explicit-any
  const [editing, setEditing] = useState<any>(null);

  const categories = useQuery({
    queryKey: ['expense-categories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expense_categories')
        .select('id, code, name, is_system, is_active')
        .eq('is_active', true)
        .order('sort_order')
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });

  const rows = useQuery({
    queryKey: ['expenses', branchId, from, to, categoryId],
    queryFn: async () => {
      let q = supabase
        .from('expenses')
        .select('id, amount, spent_on, payment_method, note, payroll_run_id, category_id, branch_id, expense_categories(name, code), branches(name)')
        .is('deleted_at', null)
        .gte('spent_on', from)
        .lte('spent_on', to)
        .order('spent_on', { ascending: false })
        .limit(500);
      if (branchId) q = q.eq('branch_id', branchId);
      if (categoryId) q = q.eq('category_id', categoryId);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const summary = useQuery({
    queryKey: ['expenses-summary', branchId, from, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('report_expenses', {
        p_from: from, p_to: to, p_branch_id: branchId ?? undefined,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  const save = useMutation({
    // deno-lint-ignore no-explicit-any
    mutationFn: async (f: any) => {
      const payload = {
        category_id: f.category_id,
        amount: Number(f.amount),
        spent_on: f.spent_on,
        payment_method: f.payment_method as 'cash' | 'bank',
        note: f.note.trim() || null,
      };
      if (f.id) {
        const { error } = await supabase.from('expenses')
          .update(payload).eq('id', f.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('expenses').insert({
          school_id: profile!.school_id,
          branch_id: f.branch_id,
          ...payload,
          created_by: profile!.id,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['expenses-summary'] });
      qc.invalidateQueries({ queryKey: ['pnl'] });
      toast.ok(t('ux.saved'));
      setAdding(false);
      setEditing(null);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  /**
   * Xarajatni bekor qilish — TZ bo'yicha yozuv JISMONAN o'chirilmaydi,
   * `deleted_at` qo'yiladi. Shu bilan hisobotdan chiqadi, lekin audit
   * jurnalida qoladi.
   */
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('expenses')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['expenses-summary'] });
      qc.invalidateQueries({ queryKey: ['pnl'] });
      toast.ok(t('exp.removed'));
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const addCategory = useMutation({
    mutationFn: async (name: string) => {
      const code = name.trim().toLowerCase()
        .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `cat_${Date.now()}`;
      const { error } = await supabase.from('expense_categories').insert({
        school_id: profile!.school_id,
        code,
        name: name.trim(),
        sort_order: 500,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expense-categories'] });
      toast.ok(t('ux.saved'));
      setAddingCategory(false);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const byCategory = useMemo(() => {
    const m = new Map<
      string,
      { id: string; name: string; amount: number; count: number }
    >();
    for (const r of summary.data ?? []) {
      const key = r.category_id ?? '';
      const cur = m.get(key) ??
        { id: key, name: r.category_name ?? '', amount: 0, count: 0 };
      cur.amount += Number(r.amount ?? 0);
      cur.count += Number(r.entries ?? 0);
      m.set(key, cur);
    }
    return [...m.values()].sort((a, b) => b.amount - a.amount);
  }, [summary.data]);

  if (!can('expenses.create')) {
    return <Notice tone="danger">{t('common.noAccess')}</Notice>;
  }
  if (rows.isLoading) return <Loading />;
  if (rows.error) {
    return <ErrorState message={(rows.error as Error).message}
                       onRetry={() => rows.refetch()} />;
  }

  const list = rows.data ?? [];
  const total = list.reduce((s, e) => s + Number(e.amount), 0);

  return (
    <>
      <PageHeader
        title={t('exp.title')}
        subtitle={t('common.showing', { count: list.length })}
        actions={
          <>
            <Button
              disabled={list.length === 0}
              onClick={() => exportTable(
                'xarajatlar',
                [
                  { header: t('common.date'), value: (e) => e.spent_on },
                  // deno-lint-ignore no-explicit-any
                  { header: t('exp.category'), value: (e) => (e as any).expense_categories?.name },
                  // deno-lint-ignore no-explicit-any
                  { header: t('common.branch'), value: (e) => (e as any).branches?.name },
                  { header: t('exp.method'), value: (e) => t(`exp.method.${e.payment_method}`) },
                  { header: t('common.note'), value: (e) => e.note },
                  { header: t('common.amount'), value: (e) => e.amount, numeric: true },
                ],
                list,
                [t('exp.title'), `${from} — ${to}`],
              )}
            >
              {t('common.export')}
            </Button>
            {mayWrite('expenses.create') && (
              <Button variant="primary" onClick={() => setAdding(true)}>
                {t('exp.add')}
              </Button>
            )}
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Field label={t('common.from')}>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label={t('common.to')}>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label={t('exp.category')}>
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
                  className="min-w-[12rem]">
            <option value="">{t('common.all')}</option>
            {(categories.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Card padded={false}>
          {list.length === 0 ? <EmptyState /> : (
            <Table>
              <thead>
                <tr>
                  <Th>{t('common.date')}</Th>
                  <Th>{t('exp.category')}</Th>
                  <Th>{t('exp.method')}</Th>
                  <Th>{t('common.note')}</Th>
                  <Th align="right">{t('common.amount')}</Th>
                  <Th align="right">{t('common.actions')}</Th>
                </tr>
              </thead>
              <tbody>
                {list.map((e) => {
                  // deno-lint-ignore no-explicit-any
                  const cat = (e as any).expense_categories;
                  const auto = !!e.payroll_run_id;
                  return (
                    <Tr key={e.id}>
                      <Td mono className="whitespace-nowrap text-[var(--text-muted)]">
                        {date(e.spent_on, lang)}
                      </Td>
                      <Td>
                        {cat?.name ?? '—'}
                        {auto && (
                          <span className="ml-1.5">
                            <Badge tone="brand">{t('exp.auto')}</Badge>
                          </span>
                        )}
                      </Td>
                      <Td className="text-[var(--text-muted)]">
                        {e.payment_method === 'cash' ? '💵' : '🏦'}{' '}
                        {t(`exp.method.${e.payment_method}`)}
                      </Td>
                      <Td className="max-w-xs truncate text-[13px]
                        text-[var(--text-muted)]">{e.note ?? '—'}</Td>
                      <Td align="right" mono>{money(e.amount, lang)}</Td>
                      <Td align="right">
                        {/* Oylikdan avtomatik yaratilgan yozuv qo'lda
                            o'zgartirilmaydi — u oylik hisobiga bog'liq
                            va u yerdan qayta yaratiladi (TZ 4.11.9). */}
                        {mayWrite('expenses.create') && !auto && (
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="ghost"
                                    onClick={() => setEditing(e)}>
                              {t('common.edit')}
                            </Button>
                            <button
                              type="button"
                              title={t('exp.remove')}
                              onClick={async () => {
                                const ok = await confirmDialog({
                                  title: t('exp.remove'),
                                  message: t('exp.removeConfirm', {
                                    amount: money(e.amount, lang),
                                    category: cat?.name ?? '',
                                  }),
                                  warning: t('exp.removeHint'),
                                  danger: true,
                                  confirmLabel: t('exp.remove'),
                                });
                                if (ok) remove.mutate(e.id);
                              }}
                              className="flex h-7 w-7 items-center justify-center
                                rounded text-[var(--text-faint)]
                                hover:bg-[var(--danger-bg)]
                                hover:text-[var(--danger)]"
                            >
                              ✕
                            </button>
                          </div>
                        )}
                        {auto && (
                          <span className="text-[11px] text-[var(--text-faint)]">
                            {t('exp.autoLocked')}
                          </span>
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-[var(--bg-subtle)] font-semibold">
                  <Td>{t('common.total')}</Td>
                  <Td /><Td /><Td />
                  <Td align="right" mono>{money(total, lang)}</Td>
                  <Td />
                </tr>
              </tfoot>
            </Table>
          )}
        </Card>

        {/* --- Kategoriyalar bo'yicha (TZ 4.10.3) --------------- */}
        <Card
          title={t('exp.byCategory')}
          action={mayWrite('expenses.create') && (
            <Button size="sm" variant="ghost"
                    onClick={() => setAddingCategory(true)}>
              +
            </Button>
          )}
          padded={false}
        >
          {byCategory.length === 0 ? <EmptyState hint="" /> : (
            <ul>
              {byCategory.map((c, i) => {
                const pct = total > 0 ? Math.round(100 * c.amount / total) : 0;
                return (
                  <li
                    key={i}
                    onClick={() => setCategoryId(
                      categoryId === c.id ? '' : (c.id ?? ''))}
                    className={`cursor-pointer border-b border-[var(--border-soft)]
                      px-4 py-2 last:border-0 hover:bg-[var(--bg-subtle)] ${
                        categoryId && categoryId === c.id
                          ? 'bg-[var(--bg-subtle)]' : ''}`}
                    title={t('exp.clickToFilter')}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[13px]">{c.name}</span>
                      <span className="num text-[13px] font-medium">
                        {money(c.amount, lang)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="h-1 flex-1 overflow-hidden rounded-full
                        bg-[var(--bg-inset)]">
                        <div className="h-full bg-brand-600"
                             style={{ width: `${pct}%` }} />
                      </div>
                      <span className="num w-8 text-right text-[11px]
                        text-[var(--text-faint)]">{pct}%</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      {(adding || editing) && (
        <ExpenseModal
          key={editing?.id ?? 'new'}
          existing={editing}
          onClose={() => { setAdding(false); setEditing(null); }}
          categories={(categories.data ?? []).filter((c) => c.code !== 'salary')}
          branches={branches}
          defaultBranch={branchId ?? branches[0]?.id ?? ''}
          onSubmit={(f) => save.mutate(f)}
          busy={save.isPending}
          error={save.error ? (save.error as Error).message : null}
        />
      )}

      <AddCategoryModal
        open={addingCategory}
        onClose={() => setAddingCategory(false)}
        onSubmit={(name) => addCategory.mutate(name)}
        busy={addCategory.isPending}
        error={addCategory.error ? (addCategory.error as Error).message : null}
      />
    </>
  );
}

// ---------------------------------------------------------------------

function ExpenseModal({
  existing, onClose, categories, branches, defaultBranch, onSubmit, busy, error,
}: {
  // deno-lint-ignore no-explicit-any
  existing: any;
  onClose: () => void;
  categories: Array<{ id: string; name: string }>;
  branches: Array<{ id: string; name: string }>;
  defaultBranch: string;
  // deno-lint-ignore no-explicit-any
  onSubmit: (f: any) => void;
  busy: boolean;
  error: string | null;
}) {
  const t = useT();
  const [f, setF] = useState({
    id: existing?.id as string | undefined,
    category_id: existing?.category_id ?? '',
    amount: existing ? String(existing.amount) : '',
    spent_on: existing?.spent_on ?? isoDate(),
    payment_method: existing?.payment_method ?? 'cash',
    note: existing?.note ?? '',
    branch_id: existing?.branch_id ?? defaultBranch,
  });
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  return (
    <Modal
      open title={existing ? t('exp.edit') : t('exp.add')} onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" form="expense-form" type="submit"
                  disabled={busy || !f.category_id || !f.amount}>
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <form
        id="expense-form"
        onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }}
        className="space-y-3"
      >
        <Field label={t('exp.category')} required>
          <Select value={f.category_id}
                  onChange={(e) => set('category_id', e.target.value)}
                  autoFocus required>
            <option value="">—</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('common.amount')} required>
            <MoneyInput value={f.amount}
                        onChange={(e) => set('amount', e.target.value)} required />
          </Field>
          <Field label={t('common.date')} required>
            <Input type="date" value={f.spent_on}
                   onChange={(e) => set('spent_on', e.target.value)} required />
          </Field>
        </div>

        <Field label={t('exp.method')} required>
          <Select value={f.payment_method}
                  onChange={(e) => set('payment_method', e.target.value)}>
            <option value="cash">{t('exp.method.cash')}</option>
            <option value="bank">{t('exp.method.bank')}</option>
          </Select>
        </Field>

        <Field label={t('common.note')}>
          <Input value={f.note} onChange={(e) => set('note', e.target.value)} />
        </Field>

        {branches.length > 1 && !existing && (
          <Field label={t('common.branch')} required>
            <Select value={f.branch_id}
                    onChange={(e) => set('branch_id', e.target.value)}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </Select>
          </Field>
        )}

        <Notice tone="neutral">
          {existing ? t('exp.editHint') : t('exp.autoHint')}
        </Notice>
        {error && <Notice tone="danger">{error}</Notice>}
      </form>
    </Modal>
  );
}

function AddCategoryModal({
  open, onClose, onSubmit, busy, error,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void;
  busy: boolean;
  error: string | null;
}) {
  const t = useT();
  const [name, setName] = useState('');

  return (
    <Modal
      open={open} title={t('exp.addCategory')} onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" form="add-cat" type="submit"
                  disabled={busy || !name.trim()}>
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <form
        id="add-cat"
        onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(name); }}
      >
        <Field label={t('common.name')} required>
          <Input value={name} onChange={(e) => setName(e.target.value)}
                 autoFocus required />
        </Field>
        {error && <div className="mt-3"><Notice tone="danger">{error}</Notice></div>}
      </form>
    </Modal>
  );
}
