// =====================================================================
//  To'lovlar (TZ 4.7) — uchta kanal bitta sahifada.
//
//  MUHIM QOIDA (TZ 4.7.3): chek rasmi HECH QANDAY HOLATDA qarzdorlikni
//  yopmaydi. Buxgalter tasdiqlagandan keyingina `payments` yozuvi
//  yaratiladi. Interfeysda `Kutilmoqda` va `Tasdiqlangan` vizual
//  jihatdan aniq ajratiladi.
// =====================================================================

import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n, useT } from '@/i18n';
import { date, dateTime, isoDate, money } from '@/lib/format';
import { exportTable, parseAmount, parseCsv, parseDate } from '@/lib/export';
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Input, Loading,
  Modal, Money, MoneyInput, Notice, PageHeader, Table, Td, Th, Tr,
} from '@/ui';
import { FilterChips, useSort, useToast } from '@/ui/Feedback';
import { ReceiptModal, type ReceiptData } from '@/features/Receipt';

type Tab = 'all' | 'proofs' | 'bank';

export default function Payments() {
  const t = useT();
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>('all');

  const proofCount = useQuery({
    queryKey: ['proof-count'],
    queryFn: async () => {
      const { count } = await supabase
        .from('payment_proofs')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending');
      return count ?? 0;
    },
  });

  if (!can('payments.create')) {
    return <Notice tone="danger">{t('common.noAccess')}</Notice>;
  }

  const TABS: Array<{ id: Tab; label: string; badge?: number }> = [
    { id: 'all', label: t('pay.tab.all') },
    { id: 'proofs', label: t('pay.tab.proofs'), badge: proofCount.data },
    { id: 'bank', label: t('pay.tab.bank') },
  ];

  return (
    <>
      <PageHeader title={t('pay.title')} />

      <div className="mb-4 flex gap-1 border-b">
        {TABS.map((x) => (
          <button
            key={x.id}
            onClick={() => setTab(x.id)}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2
              text-[13px] font-medium transition-colors
              ${tab === x.id
                ? 'border-brand-700 text-[var(--text)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'}`}
          >
            {x.label}
            {!!x.badge && <Badge tone="warn">{x.badge}</Badge>}
          </button>
        ))}
      </div>

      {tab === 'all' && <AllPayments />}
      {tab === 'proofs' && <Proofs />}
      {tab === 'bank' && <BankStatements />}
    </>
  );
}

// =====================================================================
//  1. BARCHA TO'LOVLAR
//
//  Bu ro'yxat — buxgalterning kundalik ish joyi. Shuning uchun har bir
//  qatordan uchta amal chiqadi:
//    · KVITANSIYA — istalgan eski to'lovni qayta chop etish
//    · TAHRIRLASH — summa/sana xato kiritilgan bo'lsa (`edit_payment`)
//    · BEKOR QILISH — yozuv o'chirilmaydi, bekor deb belgilanadi
// =====================================================================

type PayStatus = 'confirmed' | 'pending' | 'cancelled';
type PaySort = 'paid_on' | 'full_name' | 'amount' | 'receipt';

function AllPayments() {
  const t = useT();
  const { lang } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const { branchId, profile, mayWrite } = useAuth();

  const [from, setFrom] = useState(
    isoDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [to, setTo] = useState(isoDate());
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<PayStatus | ''>('');
  const [channel, setChannel] = useState<'cash' | 'bank' | 'proof' | ''>('');

  const [cancelling, setCancelling] = useState<{ id: string; label: string } | null>(null);
  // deno-lint-ignore no-explicit-any
  const [editing, setEditing] = useState<any>(null);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);

  const sort = useSort<PaySort>('paid_on', 'desc');

  const rows = useQuery({
    queryKey: ['payments-list', branchId, from, to],
    queryFn: async () => {
      let q = supabase
        .from('payments')
        .select('id, amount, channel, status, paid_on, note, student_id, branch_id, created_at, students(full_name, class_name, payment_code), cash_receipts(receipt_code, cancelled_at), branches(name)')
        .gte('paid_on', from)
        .lte('paid_on', to)
        .order('paid_on', { ascending: false })
        .limit(500);
      if (branchId) q = q.eq('branch_id', branchId);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const cancel = useMutation({
    mutationFn: async (v: { id: string; reason: string }) => {
      const { error } = await supabase.rpc('cancel_payment', {
        p_payment_id: v.id, p_reason: v.reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payments-list'] });
      qc.invalidateQueries({ queryKey: ['students'] });
      qc.invalidateQueries({ queryKey: ['student'] });
      toast.ok(t('pay.cancelled'));
      setCancelling(null);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const edit = useMutation({
    mutationFn: async (v: {
      id: string; amount: number; paid_on: string; note: string; reason: string;
    }) => {
      const { error } = await supabase.rpc('edit_payment', {
        p_payment_id: v.id,
        p_amount: v.amount,
        p_paid_on: v.paid_on,
        p_note: v.note || undefined,
        p_reason: v.reason || undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payments-list'] });
      qc.invalidateQueries({ queryKey: ['students'] });
      qc.invalidateQueries({ queryKey: ['student'] });
      toast.ok(t('pay.edited'));
      setEditing(null);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  /** Eski kvitansiyani qayta ochish — qoldiq ayni damdagi holat bo'yicha. */
  async function openReceipt(p: Record<string, unknown>) {
    // deno-lint-ignore no-explicit-any
    const st = (p as any).students;
    // deno-lint-ignore no-explicit-any
    const rc = (p as any).cash_receipts?.[0];
    // deno-lint-ignore no-explicit-any
    const br = (p as any).branches;
    if (!rc?.receipt_code) {
      toast.warn(t('pay.noReceipt'));
      return;
    }
    const { data: bal } = await supabase
      .from('v_student_balances')
      .select('balance')
      .eq('student_id', p.student_id as string)
      .maybeSingle();

    setReceipt({
      receipt_code: rc.receipt_code,
      amount: p.amount as number,
      paid_on: p.paid_on as string,
      student_name: st?.full_name ?? '',
      student_class: st?.class_name ?? null,
      payment_code: st?.payment_code ?? null,
      balance: bal?.balance ?? null,
      cashier: profile?.full_name ?? null,
      school_name: profile?.school_name ?? '',
      branch_name: br?.name ?? null,
    });
  }

  const list = useMemo(() => {
    let out = rows.data ?? [];
    const q = search.trim().toLowerCase();
    if (q) {
      out = out.filter((p) => {
        // deno-lint-ignore no-explicit-any
        const st = (p as any).students;
        // deno-lint-ignore no-explicit-any
        const rc = (p as any).cash_receipts?.[0];
        return (st?.full_name ?? '').toLowerCase().includes(q)
          || (st?.payment_code ?? '').toLowerCase().includes(q)
          || (rc?.receipt_code ?? '').toLowerCase().includes(q)
          || (p.note ?? '').toLowerCase().includes(q);
      });
    }
    if (status) out = out.filter((p) => p.status === status);
    if (channel) out = out.filter((p) => p.channel === channel);
    return sort.apply(out, (p, k) => {
      // deno-lint-ignore no-explicit-any
      const any = p as any;
      if (k === 'full_name') return any.students?.full_name;
      if (k === 'receipt') return any.cash_receipts?.[0]?.receipt_code;
      if (k === 'amount') return Number(p.amount);
      return p.paid_on;
    });
  }, [rows.data, search, status, channel, sort.apply]);

  if (rows.isLoading) return <Loading />;
  if (rows.error) {
    return <ErrorState message={(rows.error as Error).message}
                       onRetry={() => rows.refetch()} />;
  }

  const all = rows.data ?? [];
  const confirmed = list.filter((p) => p.status === 'confirmed');
  const total = confirmed.reduce((s, p) => s + Number(p.amount), 0);

  const CHANNEL_ICON: Record<string, string> = {
    cash: '💵', bank: '🏦', proof: '📸',
  };

  const SortTh = ({ k, children, align }: {
    k: PaySort; children: string; align?: 'right';
  }) => (
    <Th align={align}>
      <button type="button" onClick={() => sort.toggle(k)}
              className="font-semibold uppercase hover:text-[var(--text)]">
        {children}{sort.indicator(k)}
      </button>
    </Th>
  );

  return (
    <>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Field label={t('common.from')}>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label={t('common.to')}>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label={t('common.search')}>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('pay.searchHint')}
            className="w-56"
          />
        </Field>
        <Button
          disabled={list.length === 0}
          onClick={() => exportTable(
            'tolovlar',
            [
              { header: t('common.date'), value: (p) => p.paid_on },
              // deno-lint-ignore no-explicit-any
              { header: t('common.fullName'), value: (p) => (p as any).students?.full_name },
              // deno-lint-ignore no-explicit-any
              { header: t('students.class'), value: (p) => (p as any).students?.class_name },
              { header: t('common.status'), value: (p) => t(`pay.status.${p.status}`) },
              { header: t('pay.tab.all'), value: (p) => t(`pay.channel.${p.channel}`) },
              // deno-lint-ignore no-explicit-any
              { header: t('pay.receipt'), value: (p) => (p as any).cash_receipts?.[0]?.receipt_code },
              { header: t('common.note'), value: (p) => p.note },
              { header: t('common.amount'), value: (p) => p.amount, numeric: true },
            ],
            list,
            [t('pay.title'), `${from} — ${to}`],
          )}
        >
          {t('common.export')}
        </Button>
      </div>

      {/* --- Tez filtrlar ---------------------------------------- */}
      <div className="mb-3 flex flex-wrap items-center gap-4">
        <FilterChips<PayStatus>
          value={status}
          onChange={setStatus}
          options={[
            { value: 'confirmed', label: t('pay.status.confirmed'),
              count: all.filter((p) => p.status === 'confirmed').length },
            { value: 'pending', label: t('pay.status.pending'),
              count: all.filter((p) => p.status === 'pending').length },
            { value: 'cancelled', label: t('pay.status.cancelled'),
              count: all.filter((p) => p.status === 'cancelled').length },
          ]}
        />
        <FilterChips<'cash' | 'bank' | 'proof'>
          value={channel}
          onChange={setChannel}
          options={[
            { value: 'cash', label: `💵 ${t('pay.channel.cash')}` },
            { value: 'bank', label: `🏦 ${t('pay.channel.bank')}` },
            { value: 'proof', label: `📸 ${t('pay.channel.proof')}` },
          ]}
        />
      </div>

      <Card padded={false}>
        {list.length === 0 ? <EmptyState /> : (
          <Table>
            <thead>
              <tr>
                <SortTh k="paid_on">{t('common.date')}</SortTh>
                <SortTh k="full_name">{t('common.fullName')}</SortTh>
                <Th>{t('pay.tab.all')}</Th>
                <SortTh k="receipt">{t('pay.receipt')}</SortTh>
                <Th>{t('common.status')}</Th>
                <SortTh k="amount" align="right">{t('common.amount')}</SortTh>
                <Th align="right">{t('common.actions')}</Th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => {
                // deno-lint-ignore no-explicit-any
                const st = (p as any).students;
                // deno-lint-ignore no-explicit-any
                const rc = (p as any).cash_receipts?.[0];
                const dim = p.status !== 'confirmed';
                return (
                  <Tr key={p.id} className={dim ? 'opacity-60' : ''}>
                    <Td mono className="whitespace-nowrap text-[var(--text-muted)]">
                      {date(p.paid_on, lang)}
                    </Td>
                    <Td>
                      <Link to={`/oquvchilar/${p.student_id}`}
                            className="font-medium hover:underline">
                        {st?.full_name ?? '—'}
                      </Link>
                      {st?.class_name && (
                        <span className="ml-1.5 text-[11px] text-[var(--text-faint)]">
                          {st.class_name}
                        </span>
                      )}
                      {p.note && (
                        <div className="text-[11px] text-[var(--text-faint)]">
                          {p.note}
                        </div>
                      )}
                    </Td>
                    <Td>{CHANNEL_ICON[p.channel]} {t(`pay.channel.${p.channel}`)}</Td>
                    <Td mono className="text-[var(--text-muted)]">
                      {rc?.receipt_code
                        ? (
                          <button
                            onClick={() => openReceipt(p)}
                            className="hover:text-[var(--text)] hover:underline"
                            title={t('pay.reprint')}
                          >
                            {rc.receipt_code}
                          </button>
                        )
                        : '—'}
                    </Td>
                    <Td>
                      <Badge tone={p.status === 'confirmed' ? 'ok'
                        : p.status === 'pending' ? 'warn' : 'neutral'}>
                        {t(`pay.status.${p.status}`)}
                      </Badge>
                    </Td>
                    <Td align="right" mono><Money value={p.amount} /></Td>
                    <Td align="right">
                      <div className="flex justify-end gap-1">
                        {rc?.receipt_code && (
                          <Button size="sm" variant="ghost"
                                  onClick={() => openReceipt(p)}>
                            🖨
                          </Button>
                        )}
                        {p.status === 'confirmed' && mayWrite('payments.create') && (
                          <>
                            <Button size="sm" variant="ghost"
                                    onClick={() => setEditing(p)}>
                              {t('common.edit')}
                            </Button>
                            <Button
                              size="sm" variant="ghost"
                              onClick={() => setCancelling({
                                id: p.id,
                                label: `${st?.full_name ?? ''} · ${money(p.amount, lang)}`,
                              })}
                            >
                              {t('pay.cancel')}
                            </Button>
                          </>
                        )}
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-[var(--bg-subtle)] font-semibold">
                <Td>{t('common.total')}</Td>
                <Td colSpan={4} className="text-[13px] font-normal
                  text-[var(--text-muted)]">
                  {t('pay.confirmedCount', { count: confirmed.length })}
                </Td>
                <Td align="right" mono>{money(total, lang)}</Td>
                <Td />
              </tr>
            </tfoot>
          </Table>
        )}
      </Card>

      {cancelling && (
        <CancelModal
          target={cancelling}
          onClose={() => setCancelling(null)}
          onSubmit={(reason) => cancel.mutate({ id: cancelling.id, reason })}
          busy={cancel.isPending}
          error={cancel.error ? (cancel.error as Error).message : null}
        />
      )}

      {editing && (
        <EditPaymentModal
          key={editing.id}
          payment={editing}
          onClose={() => setEditing(null)}
          onSubmit={(v) => edit.mutate({ id: editing.id, ...v })}
          busy={edit.isPending}
          error={edit.error ? (edit.error as Error).message : null}
        />
      )}

      <ReceiptModal data={receipt} onClose={() => setReceipt(null)} />
    </>
  );
}

function CancelModal({
  target, onClose, onSubmit, busy, error,
}: {
  target: { id: string; label: string };
  onClose: () => void;
  onSubmit: (reason: string) => void;
  busy: boolean;
  error: string | null;
}) {
  const t = useT();
  const [reason, setReason] = useState('');

  return (
    <Modal
      open
      title={t('pay.cancel')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="danger" form="cancel-pay" type="submit"
                  disabled={busy || reason.trim().length < 5}>
            {busy ? t('common.saving') : t('common.confirm')}
          </Button>
        </>
      }
    >
      <form
        id="cancel-pay"
        onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(reason); }}
        className="space-y-3"
      >
        <p className="text-[13px]">{target.label}</p>
        <Field label={t('pay.cancelReason')} required
               hint={t('pay.cancelReasonHint')}>
          <Input value={reason} onChange={(e) => setReason(e.target.value)}
                 autoFocus required />
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
      </form>
    </Modal>
  );
}

/**
 * To'lovni tahrirlash.
 *
 * Bazaga to'g'ridan-to'g'ri yozilmaydi: `edit_payment` server funksiyasi
 * huquqni, filialni va DAVR QULFINI tekshiradi, o'zgarishni audit
 * jurnaliga yozadi va summa o'zgargan bo'lsa ota-onaga tuzatish
 * xabarini yuboradi (TZ 5.4.6, 5.4.9, 5.4.10).
 */
function EditPaymentModal({
  payment, onClose, onSubmit, busy, error,
}: {
  // deno-lint-ignore no-explicit-any
  payment: any;
  onClose: () => void;
  onSubmit: (v: {
    amount: number; paid_on: string; note: string; reason: string;
  }) => void;
  busy: boolean;
  error: string | null;
}) {
  const t = useT();
  const { lang } = useI18n();

  const [amount, setAmount] = useState(String(payment.amount ?? ''));
  const [paidOn, setPaidOn] = useState(payment.paid_on ?? isoDate());
  const [note, setNote] = useState(payment.note ?? '');
  const [reason, setReason] = useState('');

  const changed = Number(amount) !== Number(payment.amount)
    || paidOn !== payment.paid_on
    || note !== (payment.note ?? '');
  const amountChanged = Number(amount) !== Number(payment.amount);
  const receipt = payment.cash_receipts?.[0]?.receipt_code;

  return (
    <Modal
      open
      title={t('pay.edit')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="primary" form="edit-pay" type="submit"
            disabled={busy || !changed || Number(amount) <= 0
              || reason.trim().length < 5}
          >
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <form
        id="edit-pay"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          onSubmit({ amount: Number(amount), paid_on: paidOn, note, reason });
        }}
        className="space-y-3"
      >
        <div className="rounded-md bg-[var(--bg-subtle)] px-3 py-2 text-[13px]">
          <div className="font-medium">{payment.students?.full_name}</div>
          <div className="text-[var(--text-muted)]">
            {t('pay.wasAmount', {
              amount: money(payment.amount, lang),
              date: date(payment.paid_on, lang),
            })}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('common.amount')} required>
            <MoneyInput value={amount} onChange={(e) => setAmount(e.target.value)}
                        autoFocus required />
          </Field>
          <Field label={t('common.date')} required>
            <Input type="date" value={paidOn}
                   onChange={(e) => setPaidOn(e.target.value)} required />
          </Field>
        </div>

        <Field label={t('common.note')}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>

        <Field label={t('pay.editReason')} required hint={t('pay.editReasonHint')}>
          <Input value={reason} onChange={(e) => setReason(e.target.value)}
                 required />
        </Field>

        {amountChanged && receipt && (
          <Notice tone="warn">
            {t('pay.receiptWarning', { code: receipt })}
          </Notice>
        )}
        {amountChanged && (
          <Notice tone="neutral">{t('pay.editNotify')}</Notice>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
      </form>
    </Modal>
  );
}

// =====================================================================
//  2. CHEKLAR (TZ 4.7.3)
//
//  MUHIM O'ZGARISH: chek rasmi ENDI ISTALGAN HOLATDA ochiladi.
//  Ilgari faqat "kutilmoqda" holatidagi chek ko'rinardi — nizo
//  chiqqanda tasdiqlangan yoki rad etilgan chekni ochib bo'lmasdi.
//
//  Shuningdek `revise_payment_proof` orqali qayta ko'rib chiqish
//  qo'shildi: rad etilganni tasdiqlash, tasdiqlangan summani tuzatish.
// =====================================================================

type ProofStatus = 'pending' | 'confirmed' | 'rejected';

function Proofs() {
  const t = useT();
  const { lang } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const { branchId, mayWrite } = useAuth();

  const [reviewing, setReviewing] = useState<Record<string, unknown> | null>(null);
  const [status, setStatus] = useState<ProofStatus | ''>('');
  const [search, setSearch] = useState('');

  const rows = useQuery({
    queryKey: ['proofs', branchId],
    queryFn: async () => {
      let q = supabase
        .from('payment_proofs')
        .select('id, student_id, amount_claimed, status, submitted_at, reviewed_at, file_path, reject_reason, payment_id, students(full_name, class_name, payment_code)')
        .order('submitted_at', { ascending: false })
        .limit(300);
      if (branchId) q = q.eq('branch_id', branchId);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  function done(msg: string) {
    qc.invalidateQueries({ queryKey: ['proofs'] });
    qc.invalidateQueries({ queryKey: ['proof-count'] });
    qc.invalidateQueries({ queryKey: ['payments-list'] });
    qc.invalidateQueries({ queryKey: ['students'] });
    toast.ok(msg);
    setReviewing(null);
  }

  const confirm = useMutation({
    mutationFn: async (v: { id: string; amount: number; paidOn: string }) => {
      const { error } = await supabase.rpc('confirm_payment_proof', {
        p_proof_id: v.id, p_amount: v.amount, p_paid_on: v.paidOn,
      });
      if (error) throw error;
    },
    onSuccess: () => done(t('pay.proofConfirmed')),
    onError: (e) => toast.error((e as Error).message),
  });

  const reject = useMutation({
    mutationFn: async (v: { id: string; reason: string }) => {
      const { error } = await supabase.rpc('reject_payment_proof', {
        p_proof_id: v.id, p_reason: v.reason,
      });
      if (error) throw error;
    },
    onSuccess: () => done(t('pay.proofRejected')),
    onError: (e) => toast.error((e as Error).message),
  });

  /** Qayta ko'rib chiqish: rad etilganni tasdiqlash / summani tuzatish. */
  const revise = useMutation({
    mutationFn: async (v: {
      id: string; action: 'confirm' | 'reject' | 'amend';
      amount?: number; reason?: string;
    }) => {
      const { error } = await supabase.rpc('revise_payment_proof', {
        p_proof_id: v.id,
        p_action: v.action,
        p_amount: v.amount ?? undefined,
        p_reason: v.reason ?? undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => done(t('pay.proofRevised')),
    onError: (e) => toast.error((e as Error).message),
  });

  const list = useMemo(() => {
    let out = rows.data ?? [];
    if (status) out = out.filter((p) => p.status === status);
    const q = search.trim().toLowerCase();
    if (q) {
      out = out.filter((p) => {
        // deno-lint-ignore no-explicit-any
        const st = (p as any).students;
        return (st?.full_name ?? '').toLowerCase().includes(q)
          || (st?.payment_code ?? '').toLowerCase().includes(q);
      });
    }
    return out;
  }, [rows.data, status, search]);

  if (rows.isLoading) return <Loading />;
  if (rows.error) return <ErrorState message={(rows.error as Error).message} />;

  const all = rows.data ?? [];
  const pending = all.filter((p) => p.status === 'pending');

  return (
    <>
      <div className="mb-3">
        <Notice tone="warn">{t('pay.proofWarning')}</Notice>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <FilterChips<ProofStatus>
          value={status}
          onChange={setStatus}
          options={[
            { value: 'pending', label: t('pay.status.pending'), count: pending.length },
            { value: 'confirmed', label: t('pay.status.confirmed'),
              count: all.filter((p) => p.status === 'confirmed').length },
            { value: 'rejected', label: t('pay.status.rejected'),
              count: all.filter((p) => p.status === 'rejected').length },
          ]}
        />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('common.search')}
          className="h-8 w-48 text-[13px]"
        />
      </div>

      <Card padded={false}>
        {list.length === 0 ? <EmptyState title={t('pay.noProofs')} hint="" /> : (
          <Table>
            <thead>
              <tr>
                <Th>{t('common.date')}</Th>
                <Th>{t('common.fullName')}</Th>
                <Th align="right">{t('pay.claimedAmount')}</Th>
                <Th>{t('common.status')}</Th>
                <Th align="right">{t('common.actions')}</Th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => {
                // deno-lint-ignore no-explicit-any
                const st = (p as any).students;
                return (
                  <Tr key={p.id} className={p.status !== 'pending' ? 'opacity-60' : ''}>
                    <Td mono className="whitespace-nowrap text-[var(--text-muted)]">
                      {dateTime(p.submitted_at, lang)}
                    </Td>
                    <Td>
                      <Link to={`/oquvchilar/${p.student_id}`}
                            className="font-medium hover:underline">
                        {st?.full_name ?? '—'}
                      </Link>
                      {st?.class_name && (
                        <span className="ml-1.5 text-[11px] text-[var(--text-faint)]">
                          {st.class_name}
                        </span>
                      )}
                    </Td>
                    <Td align="right" mono>
                      {p.amount_claimed ? money(p.amount_claimed, lang) : '—'}
                    </Td>
                    <Td>
                      <Badge tone={p.status === 'confirmed' ? 'ok'
                        : p.status === 'pending' ? 'warn' : 'danger'}>
                        {t(`pay.status.${p.status}`)}
                      </Badge>
                      {p.reject_reason && (
                        <div className="text-[11px] text-[var(--text-faint)]">
                          {p.reject_reason}
                        </div>
                      )}
                    </Td>
                    <Td align="right">
                      {/* Chek ISTALGAN holatda ochiladi — isbot kerak bo'lganda. */}
                      <Button size="sm"
                              variant={p.status === 'pending' ? 'primary' : 'ghost'}
                              onClick={() => setReviewing(p)}>
                        {p.status === 'pending'
                          ? t('common.confirm')
                          : t('pay.viewProof')}
                      </Button>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {pending.length > 0 && (
        <p className="mt-2 text-[12px] text-[var(--text-faint)]">
          {t('pay.proofsPending')}: {pending.length}
        </p>
      )}

      {reviewing && (
        <ProofReviewModal
          key={reviewing.id as string}
          proof={reviewing}
          canWrite={mayWrite('payments.create')}
          onClose={() => setReviewing(null)}
          onConfirm={(amount, paidOn) =>
            confirm.mutate({ id: reviewing.id as string, amount, paidOn })}
          onReject={(reason) =>
            reject.mutate({ id: reviewing.id as string, reason })}
          onRevise={(action, amount, reason) =>
            revise.mutate({ id: reviewing.id as string, action, amount, reason })}
          busy={confirm.isPending || reject.isPending || revise.isPending}
          error={(confirm.error ?? reject.error ?? revise.error) as Error | null}
        />
      )}
    </>
  );
}

function ProofReviewModal({
  proof, canWrite, onClose, onConfirm, onReject, onRevise, busy, error,
}: {
  proof: Record<string, unknown>;
  canWrite: boolean;
  onClose: () => void;
  onConfirm: (amount: number, paidOn: string) => void;
  onReject: (reason: string) => void;
  onRevise: (
    action: 'confirm' | 'reject' | 'amend',
    amount?: number,
    reason?: string,
  ) => void;
  busy: boolean;
  error: Error | null;
}) {
  const t = useT();
  const { lang } = useI18n();

  const status = proof.status as ProofStatus;
  const isPending = status === 'pending';

  const [amount, setAmount] = useState(
    proof.amount_claimed ? String(proof.amount_claimed) : '');
  const [paidOn, setPaidOn] = useState(isoDate());
  const [mode, setMode] = useState<'view' | 'reject' | 'revise'>('view');
  const [reason, setReason] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [loadingImage, setLoadingImage] = useState(false);

  // Chek rasmi VAQTINCHALIK havola orqali ochiladi (TZ 5.5.8) —
  // ochiq URL bilan emas. Havola 5 daqiqada kuchini yo'qotadi.
  useEffect(() => {
    const path = proof.file_path as string | null;
    if (!path) return;
    let alive = true;
    setLoadingImage(true);
    supabase.storage.from('receipts').createSignedUrl(path, 300)
      .then(({ data, error: e }) => {
        if (!alive) return;
        setLoadingImage(false);
        if (e) setImageError(e.message);
        else setImageUrl(data?.signedUrl ?? null);
      });
    return () => { alive = false; };
  }, [proof.file_path]);

  // deno-lint-ignore no-explicit-any
  const student = (proof as any).students;

  const footer = (() => {
    if (!canWrite) {
      return <Button onClick={onClose}>{t('common.close')}</Button>;
    }
    if (mode === 'reject') {
      return (
        <>
          <Button onClick={() => setMode('view')}>{t('common.back')}</Button>
          <Button variant="danger" disabled={busy || reason.trim().length < 3}
                  onClick={() => isPending
                    ? onReject(reason)
                    : onRevise('reject', undefined, reason)}>
            {t('pay.reject')}
          </Button>
        </>
      );
    }
    if (mode === 'revise') {
      return (
        <>
          <Button onClick={() => setMode('view')}>{t('common.back')}</Button>
          <Button
            variant="primary"
            disabled={busy || !amount || Number(amount) <= 0
              || reason.trim().length < 5}
            onClick={() => onRevise(
              status === 'rejected' ? 'confirm' : 'amend',
              Number(amount),
              reason,
            )}
          >
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        </>
      );
    }
    if (isPending) {
      return (
        <>
          <Button variant="ghost" onClick={() => setMode('reject')}>
            {t('pay.reject')}
          </Button>
          <Button
            variant="accent"
            disabled={busy || !amount || Number(amount) <= 0}
            onClick={() => onConfirm(Number(amount), paidOn)}
          >
            {busy ? t('common.saving') : t('pay.confirm')}
          </Button>
        </>
      );
    }
    // Tasdiqlangan yoki rad etilgan — qayta ko'rib chiqish mumkin.
    return (
      <>
        <Button onClick={onClose}>{t('common.close')}</Button>
        <Button variant="primary" onClick={() => setMode('revise')}>
          {status === 'rejected' ? t('pay.reviseConfirm') : t('pay.reviseAmount')}
        </Button>
      </>
    );
  })();

  return (
    <Modal open title={t('pay.tab.proofs')} onClose={onClose} wide footer={footer}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-medium">{student?.full_name}</div>
            <div className="text-[12px] text-[var(--text-muted)]">
              {dateTime(proof.submitted_at as string, lang)}
              {student?.class_name && ` · ${student.class_name}`}
            </div>
          </div>
          <Badge tone={status === 'confirmed' ? 'ok'
            : status === 'pending' ? 'warn' : 'danger'}>
            {t(`pay.status.${status}`)}
          </Badge>
        </div>

        {/* --- Chek rasmi — istalgan holatda --------------------- */}
        {proof.file_path
          ? loadingImage
            ? <Loading />
            : imageUrl
            ? (
              <div className="space-y-1">
                <img src={imageUrl} alt=""
                     className="max-h-[28rem] w-full rounded border object-contain
                       bg-[var(--bg-inset)]" />
                <a href={imageUrl} target="_blank" rel="noreferrer"
                   className="text-[12px] text-brand-700 hover:underline">
                  {t('pay.openFullSize')} ↗
                </a>
              </div>
            )
            : <Notice tone="danger">{imageError ?? t('pay.imageMissing')}</Notice>
          : <Notice tone="neutral">{t('pay.imageMissing')}</Notice>}

        {!!proof.reject_reason && (
          <Notice tone="danger">
            {t('pay.rejectedFor', { reason: proof.reject_reason as string })}
          </Notice>
        )}

        {mode === 'reject' && (
          <Field label={t('pay.rejectReason')} required
                 hint={t('pay.rejectReasonHint')}>
            <Input value={reason} onChange={(e) => setReason(e.target.value)}
                   autoFocus />
          </Field>
        )}

        {mode === 'revise' && (
          <>
            <Notice tone="warn">
              {status === 'rejected'
                ? t('pay.reviseConfirmHint')
                : t('pay.reviseAmountHint')}
            </Notice>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('common.amount')} required>
                <MoneyInput value={amount}
                            onChange={(e) => setAmount(e.target.value)} autoFocus />
              </Field>
              <Field label={t('pay.editReason')} required>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
            </div>
          </>
        )}

        {mode === 'view' && isPending && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('common.amount')} required
                   hint={proof.amount_claimed
                     ? t('pay.parentClaims', {
                         amount: money(proof.amount_claimed as number, lang) })
                     : t('pay.noClaim')}>
              <MoneyInput value={amount} onChange={(e) => setAmount(e.target.value)}
                          autoFocus />
            </Field>
            <Field label={t('common.date')} required>
              <Input type="date" value={paidOn}
                     onChange={(e) => setPaidOn(e.target.value)} />
            </Field>
          </div>
        )}

        {error && <Notice tone="danger">{error.message}</Notice>}
      </div>
    </Modal>
  );
}

// =====================================================================
//  3. BANK VYPISKASI (TZ 4.7.2)
// =====================================================================

interface ParsedRow {
  paid_on: string;
  amount: number;
  payer_name: string;
  purpose: string;
  doc_no: string;
}

function BankStatements() {
  const t = useT();
  const { lang } = useI18n();
  const qc = useQueryClient();
  const { branchId, branches, profile, mayWrite } = useAuth();

  const [parsed, setParsed] = useState<ParsedRow[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, number> | null>(null);
  const [matching, setMatching] = useState<Record<string, unknown> | null>(null);

  const activeBranch = branchId ?? branches[0]?.id ?? null;

  const statements = useQuery({
    queryKey: ['statements', branchId],
    queryFn: async () => {
      let q = supabase
        .from('bank_statements')
        .select('id, file_name, uploaded_at, rows_total, rows_matched, processed_at')
        .order('uploaded_at', { ascending: false })
        .limit(20);
      if (branchId) q = q.eq('branch_id', branchId);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const unmatched = useQuery({
    queryKey: ['unmatched-rows'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bank_statement_rows')
        .select('id, paid_on, amount, payer_name, purpose, payment_code, doc_no')
        .is('student_id', null)
        .order('paid_on', { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  /** Faylni o'qib, qatorlarni ajratadi. Yuklash keyingi qadamda. */
  async function onFile(file: File) {
    setParseError(null);
    setResult(null);
    setFileName(file.name);

    try {
      const text = await file.text();
      const { headers, rows } = parseCsv(text);
      if (!rows.length) throw new Error('Faylda qator topilmadi');

      // Ustunlarni nomi bo'yicha topamiz — bank formatlari har xil.
      const find = (...names: string[]) => {
        const i = headers.findIndex((h) =>
          names.some((n) => h.toLowerCase().includes(n)));
        return i;
      };

      const iDate = find('sana', 'дата', 'date');
      const iAmount = find('summa', 'сумма', 'amount', 'kredit', 'кредит');
      const iPayer = find('tolovchi', "to'lovchi", 'плательщик', 'payer', 'nomi');
      const iPurpose = find('maqsad', 'izoh', 'назначение', 'purpose', 'detali');
      const iDoc = find('hujjat', 'документ', 'doc', 'raqam', '№');

      if (iDate < 0 || iAmount < 0) {
        throw new Error(
          `Sana yoki summa ustuni topilmadi. Fayldagi ustunlar: ${headers.join(', ')}`,
        );
      }

      const out: ParsedRow[] = [];
      for (const r of rows) {
        const d = parseDate(r[iDate] ?? '');
        const a = parseAmount(r[iAmount] ?? '');
        if (!d || !a || a <= 0) continue;
        out.push({
          paid_on: d,
          amount: a,
          payer_name: iPayer >= 0 ? (r[iPayer] ?? '') : '',
          purpose: iPurpose >= 0 ? (r[iPurpose] ?? '') : '',
          doc_no: iDoc >= 0 ? (r[iDoc] ?? '') : '',
        });
      }

      if (!out.length) throw new Error("O'qiladigan qator topilmadi");
      setParsed(out);
    } catch (err) {
      setParsed(null);
      setParseError((err as Error).message);
    }
  }

  const upload = useMutation({
    mutationFn: async () => {
      // 1) Vypiska yozuvi (TZ 4.7.2.5 — fayl nomi saqlanadi)
      const { data: st, error: sErr } = await supabase
        .from('bank_statements')
        .insert({
          school_id: profile!.school_id,
          branch_id: activeBranch!,
          file_path: `${profile!.school_id}/${Date.now()}-${fileName}`,
          file_name: fileName,
          uploaded_by: profile!.id,
        })
        .select('id')
        .single();
      if (sErr) throw sErr;

      // 2) Qatorlarni server tomonda biriktiramiz (TZ 5.4.6)
      const { data, error } = await supabase.rpc('import_bank_rows', {
        p_statement_id: st.id,
        p_rows: parsed as never,
      });
      if (error) throw error;
      return data as Record<string, number>;
    },
    onSuccess: (d) => {
      setResult(d);
      setParsed(null);
      qc.invalidateQueries({ queryKey: ['statements'] });
      qc.invalidateQueries({ queryKey: ['unmatched-rows'] });
      qc.invalidateQueries({ queryKey: ['payments-list'] });
    },
  });

  const match = useMutation({
    mutationFn: async (v: { rowId: string; studentId: string }) => {
      const { error } = await supabase.rpc('match_statement_row', {
        p_row_id: v.rowId, p_student_id: v.studentId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['unmatched-rows'] });
      qc.invalidateQueries({ queryKey: ['payments-list'] });
      setMatching(null);
    },
  });

  return (
    <div className="space-y-4">
      {/* --- Yuklash ------------------------------------------- */}
      {mayWrite('payments.create') && (
        <Card title={t('pay.uploadStatement')}>
          <p className="mb-3 text-[12px] text-[var(--text-muted)]">
            {t('pay.statementHint')}
          </p>

          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
            }}
            className="block w-full text-[13px] file:mr-3 file:rounded-md
              file:border file:bg-[var(--bg)] file:px-3 file:py-1.5
              file:text-[13px] file:font-medium hover:file:bg-[var(--bg-inset)]"
          />

          {parseError && (
            <div className="mt-3"><Notice tone="danger">{parseError}</Notice></div>
          )}

          {parsed && (
            <div className="mt-3 space-y-2">
              <Notice tone="neutral">
                {fileName} — {parsed.length} ta qator o'qildi
              </Notice>
              <div className="max-h-56 overflow-auto rounded border">
                <Table>
                  <thead>
                    <tr>
                      <Th>{t('common.date')}</Th>
                      <Th align="right">{t('common.amount')}</Th>
                      <Th>{t('pay.payer')}</Th>
                      <Th>{t('pay.purpose')}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.slice(0, 20).map((r, i) => (
                      <Tr key={i}>
                        <Td mono>{date(r.paid_on, lang)}</Td>
                        <Td align="right" mono>{money(r.amount, lang)}</Td>
                        <Td className="text-[var(--text-muted)]">{r.payer_name}</Td>
                        <Td className="max-w-xs truncate text-[12px]
                          text-[var(--text-muted)]">{r.purpose}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </div>
              <Button variant="primary" onClick={() => upload.mutate()}
                      disabled={upload.isPending}>
                {upload.isPending ? t('common.saving') : t('pay.uploadStatement')}
              </Button>
            </div>
          )}

          {upload.error && (
            <div className="mt-3">
              <Notice tone="danger">{(upload.error as Error).message}</Notice>
            </div>
          )}

          {result && (
            <div className="mt-3">
              <Notice tone={Number(result.match_rate) >= 80 ? 'ok' : 'warn'}>
                {t('pay.rowsAdded', {
                  added: result.added,
                  matched: result.matched,
                  rate: result.match_rate,
                })}
                {result.duplicates > 0 && (
                  <> · {t('pay.duplicates', { n: result.duplicates })}</>
                )}
              </Notice>
            </div>
          )}
        </Card>
      )}

      {/* --- Biriktirilmagan qatorlar (TZ 4.7.2.3) ------------- */}
      {(unmatched.data?.length ?? 0) > 0 && (
        <Card
          title={`${t('pay.unmatched')} · ${unmatched.data!.length}`}
          padded={false}
        >
          <Table>
            <thead>
              <tr>
                <Th>{t('common.date')}</Th>
                <Th align="right">{t('common.amount')}</Th>
                <Th>{t('pay.payer')}</Th>
                <Th>{t('pay.purpose')}</Th>
                <Th align="right">{t('common.actions')}</Th>
              </tr>
            </thead>
            <tbody>
              {unmatched.data!.map((r) => (
                <Tr key={r.id}>
                  <Td mono>{date(r.paid_on, lang)}</Td>
                  <Td align="right" mono>{money(r.amount, lang)}</Td>
                  <Td className="text-[var(--text-muted)]">{r.payer_name ?? '—'}</Td>
                  <Td className="max-w-xs truncate text-[12px]
                    text-[var(--text-muted)]">{r.purpose ?? '—'}</Td>
                  <Td align="right">
                    {mayWrite('payments.create') && (
                      <Button size="sm" onClick={() => setMatching(r)}>
                        {t('pay.matchManually')}
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {/* --- Yuklangan vypiskalar ----------------------------- */}
      <Card title={t('pay.tab.bank')} padded={false}>
        {(statements.data?.length ?? 0) === 0 ? <EmptyState /> : (
          <Table>
            <thead>
              <tr>
                <Th>{t('common.date')}</Th>
                <Th>{t('common.name')}</Th>
                <Th align="right">{t('common.count')}</Th>
                <Th align="right">{t('pay.matched')}</Th>
                <Th align="right">{t('pay.matchRate')}</Th>
              </tr>
            </thead>
            <tbody>
              {statements.data!.map((s) => {
                const rate = s.rows_total > 0
                  ? Math.round(100 * s.rows_matched / s.rows_total)
                  : 0;
                return (
                  <Tr key={s.id}>
                    <Td mono className="text-[var(--text-muted)]">
                      {dateTime(s.uploaded_at, lang)}
                    </Td>
                    <Td>{s.file_name}</Td>
                    <Td align="right" mono>{s.rows_total}</Td>
                    <Td align="right" mono>{s.rows_matched}</Td>
                    <Td align="right">
                      {/* TZ 4.7.2.6 — kamida 80% */}
                      <Badge tone={rate >= 80 ? 'ok' : 'warn'}>{rate}%</Badge>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <MatchModal
        row={matching}
        onClose={() => setMatching(null)}
        onSubmit={(studentId) =>
          match.mutate({ rowId: matching!.id as string, studentId })}
        busy={match.isPending}
        error={match.error ? (match.error as Error).message : null}
      />
    </div>
  );
}

function MatchModal({
  row, onClose, onSubmit, busy, error,
}: {
  row: Record<string, unknown> | null;
  onClose: () => void;
  onSubmit: (studentId: string) => void;
  busy: boolean;
  error: string | null;
}) {
  const t = useT();
  const { lang } = useI18n();
  const { branchId } = useAuth();
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState('');

  const students = useQuery({
    queryKey: ['students-pick', branchId],
    enabled: !!row,
    queryFn: async () => {
      let q = supabase
        .from('students')
        .select('id, full_name, class_name, payment_code')
        .eq('status', 'active')
        .is('deleted_at', null)
        .order('full_name');
      if (branchId) q = q.eq('branch_id', branchId);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const filtered = useMemo(() => {
    const n = search.trim().toLowerCase();
    const all = students.data ?? [];
    if (!n) return all.slice(0, 30);
    return all.filter((s) =>
      s.full_name.toLowerCase().includes(n) ||
      s.payment_code.toLowerCase().includes(n) ||
      (s.class_name ?? '').toLowerCase().includes(n)
    ).slice(0, 30);
  }, [students.data, search]);

  return (
    <Modal
      open={!!row}
      title={t('pay.matchManually')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={busy || !picked}
                  onClick={() => onSubmit(picked)}>
            {busy ? t('common.saving') : t('common.confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="rounded-md bg-[var(--bg-inset)] px-3 py-2 text-[13px]">
          <div className="num font-semibold">
            {money(row?.amount as number, lang)} · {date(row?.paid_on as string, lang)}
          </div>
          <div className="text-[var(--text-muted)]">{String(row?.payer_name ?? '')}</div>
          <div className="text-[12px] text-[var(--text-faint)]">
            {String(row?.purpose ?? '')}
          </div>
        </div>

        <Field label={t('pay.selectStudent')}>
          <Input value={search} onChange={(e) => setSearch(e.target.value)}
                 placeholder={t('students.searchHint')} autoFocus />
        </Field>

        <div className="max-h-64 overflow-auto rounded border">
          {filtered.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setPicked(s.id)}
              className={`flex w-full items-center justify-between gap-2 border-b
                border-[var(--border-soft)] px-3 py-2 text-left text-[13px]
                last:border-0
                ${picked === s.id
                  ? 'bg-brand-50 font-medium'
                  : 'hover:bg-[var(--bg-subtle)]'}`}
            >
              <span>
                {s.full_name}
                {s.class_name && (
                  <span className="ml-1.5 text-[var(--text-faint)]">{s.class_name}</span>
                )}
              </span>
              <span className="num text-[12px] text-[var(--text-muted)]">
                {s.payment_code}
              </span>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="px-3 py-4 text-center text-[13px] text-[var(--text-faint)]">
              {t('common.empty')}
            </p>
          )}
        </div>

        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </Modal>
  );
}
