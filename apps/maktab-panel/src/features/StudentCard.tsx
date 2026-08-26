// =====================================================================
//  O'quvchi kartochkasi: to'liq ma'lumot, shartnoma, ota-onalar,
//  xizmatlar, hisoblanma, to'lov tarixi va o'zgarishlar tarixi.
//
//  TZ 4.12.6 — "Hisobotdagi har qanday raqamdan uni tashkil qilgan
//  boshlang'ich yozuvlarga o'tish imkoniyati bo'ladi." Shu sahifa
//  o'quvchi bo'yicha o'sha "pastki qatlam".
//
//  Bu yerda hech narsa qisqartirilmaydi: to'lov tarixi to'liq,
//  chek rasmi istalgan holatda ochiladi, kvitansiya qayta chop
//  etiladi. Nizoli holatda buxgalter shu sahifadan chiqmaydi.
// =====================================================================

import { type FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n, useT } from '@/i18n';
import { date, dateTime, isoDate, money, periodLabel } from '@/lib/format';
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Input, Loading,
  Modal, Money, MoneyInput, Notice, PageHeader, Table, Td, Th, Tr,
} from '@/ui';
import { useConfirm, useToast } from '@/ui/Feedback';
import {
  ContractModal, type ParentLink, ParentModal, ServiceModal, StudentEditModal,
} from './student/StudentModals';
import { ReceiptModal, type ReceiptData } from './Receipt';
import {
  defaultMethodId,
  PaymentMethodPicker,
  usePaymentMethods,
} from '@/ui/PaymentMethodPicker';

/** Tug'ilgan sanadan yosh. */
function ageFrom(birth: string | null | undefined): number | null {
  if (!birth) return null;
  const b = new Date(birth);
  if (Number.isNaN(b.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}

/** Ikki sana orasidagi to'liq oylar soni. */
function monthsBetween(from: string, to: string | null): number {
  const a = new Date(from);
  const b = to ? new Date(to) : new Date();
  return Math.max(0,
    (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()));
}

export default function StudentCard() {
  const { id } = useParams<{ id: string }>();
  const t = useT();
  const { lang } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const confirmDialog = useConfirm();
  const { mayWrite, profile } = useAuth();

  const [payOpen, setPayOpen] = useState(false);
  const [contractOpen, setContractOpen] = useState(false);
  const [parentOpen, setParentOpen] = useState(false);
  const [editingParent, setEditingParent] = useState<ParentLink | null>(null);
  const [serviceOpen, setServiceOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [allPayments, setAllPayments] = useState(false);
  // deno-lint-ignore no-explicit-any
  const [editingPayment, setEditingPayment] = useState<any>(null);
  const [openInvoice, setOpenInvoice] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const student = useQuery({
    queryKey: ['student', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('students')
        .select('*, branches(name), classes(id, name, academic_year)')
        .eq('id', id!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const balance = useQuery({
    queryKey: ['student-balance', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_student_balances')
        .select('*')
        .eq('student_id', id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const contract = useQuery({
    queryKey: ['student-contract', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contracts')
        .select('*, discount_types(name, kind, value)')
        .eq('student_id', id!)
        .eq('is_active', true)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const parents = useQuery({
    queryKey: ['student-parents', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('student_parents')
        .select('relation, is_primary, parents(id, full_name, phone, telegram_id, lang)')
        .eq('student_id', id!);
      if (error) throw error;
      return data ?? [];
    },
  });

  const services = useQuery({
    queryKey: ['student-services', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('student_services')
        .select('id, starts_on, ends_on, services(id, name, billing_type)')
        .eq('student_id', id!)
        .order('starts_on', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const invoices = useQuery({
    queryKey: ['student-invoices', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_invoice_totals')
        .select('invoice_id, period, total, status, due_date, has_preliminary')
        .eq('student_id', id!)
        .order('period', { ascending: false })
        .limit(24);
      if (error) throw error;
      return data ?? [];
    },
  });

  // TO'LIQ to'lov tarixi — cheklovsiz. Kvitansiya raqami bilan birga,
  // shunda eski chekni shu yerdan qayta chop etish mumkin.
  const payments = useQuery({
    queryKey: ['student-payments', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payments')
        .select('id, amount, channel, status, paid_on, note, created_at, branch_id, cash_receipts(receipt_code)')
        .eq('student_id', id!)
        .order('paid_on', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Chek rasmlari — istalgan holatda ko'rish uchun (TZ 4.7.3).
  const proofs = useQuery({
    queryKey: ['student-proofs', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payment_proofs')
        .select('id, amount_claimed, status, submitted_at, file_path, reject_reason')
        .eq('student_id', id!)
        .order('submitted_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  const history = useQuery({
    queryKey: ['student-history', id],
    enabled: !!id && historyOpen,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('student_history', {
        p_student_id: id!, p_limit: 200,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  const invoiceLines = useQuery({
    queryKey: ['invoice-lines', openInvoice],
    enabled: !!openInvoice,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invoice_lines')
        .select('id, kind, description, quantity, unit_price, amount')
        .eq('invoice_id', openInvoice!)
        .order('kind');
      if (error) throw error;
      return data ?? [];
    },
  });

  // --- Kassa to'lovi (TZ 4.7.1) — server tomonda (TZ 5.4.6) --------
  const pay = useMutation({
    mutationFn: async (v: {
      amount: number; paid_on: string; note: string; method_id: string;
    }) => {
      const { data, error } = await supabase.rpc('register_cash_payment', {
        p_student_id: id!,
        p_amount: v.amount,
        p_paid_on: v.paid_on,
        p_note: v.note || undefined,
        p_method_id: v.method_id || undefined,
      });
      if (error) throw error;
      return data as {
        receipt_code: string; balance: number; method_name: string;
      };
    },
    onSuccess: (res, vars) => {
      qc.invalidateQueries({ queryKey: ['student-balance', id] });
      qc.invalidateQueries({ queryKey: ['student-payments', id] });
      qc.invalidateQueries({ queryKey: ['students'] });
      setPayOpen(false);
      // TZ 4.7.1.2 — raqamlangan kvitansiya darhol ko'rsatiladi.
      setReceipt({
        receipt_code: res.receipt_code,
        amount: vars.amount,
        paid_on: vars.paid_on,
        student_name: student.data?.full_name ?? '',
        student_class: student.data?.class_name,
        payment_code: student.data?.payment_code,
        balance: res.balance,
        cashier: profile?.full_name,
        school_name: profile?.school_name ?? '',
        // deno-lint-ignore no-explicit-any
        branch_name: (student.data as any)?.branches?.name,
        method_name: res.method_name,
      });
    },
  });

  const editPayment = useMutation({
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
      qc.invalidateQueries({ queryKey: ['student-payments', id] });
      qc.invalidateQueries({ queryKey: ['student-balance', id] });
      qc.invalidateQueries({ queryKey: ['student-history', id] });
      toast.ok(t('pay.edited'));
      setEditingPayment(null);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const detachParent = useMutation({
    mutationFn: async (parentId: string) => {
      const { error } = await supabase.rpc('detach_parent', {
        p_student_id: id!, p_parent_id: parentId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['student-parents', id] });
      toast.ok(t('parents.detached'));
    },
    onError: (e) => toast.error((e as Error).message),
  });

  // TZ 4.4.3 — bekor qilish sanasi qayd etiladi, yozuv o'chirilmaydi.
  const unassign = useMutation({
    mutationFn: async (rowId: string) => {
      const { error } = await supabase
        .from('student_services')
        .update({ ends_on: isoDate() })
        .eq('id', rowId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['student-services', id] });
      toast.ok(t('services.unassigned'));
    },
    onError: (e) => toast.error((e as Error).message),
  });

  /** Eski kvitansiyani qayta ochish. */
  function openReceipt(p: Record<string, unknown>) {
    // deno-lint-ignore no-explicit-any
    const code = (p as any).cash_receipts?.[0]?.receipt_code;
    if (!code) { toast.warn(t('pay.noReceipt')); return; }
    setReceipt({
      receipt_code: code,
      amount: p.amount as number,
      paid_on: p.paid_on as string,
      student_name: student.data?.full_name ?? '',
      student_class: student.data?.class_name,
      payment_code: student.data?.payment_code,
      balance: balance.data?.balance ?? null,
      cashier: profile?.full_name,
      school_name: profile?.school_name ?? '',
      // deno-lint-ignore no-explicit-any
      branch_name: (student.data as any)?.branches?.name,
    });
  }

  const payList = useMemo(() => {
    const all = payments.data ?? [];
    return allPayments ? all : all.slice(0, 10);
  }, [payments.data, allPayments]);

  if (student.isLoading) return <Loading />;
  if (student.error) {
    return <ErrorState message={(student.error as Error).message} />;
  }
  if (!student.data) return <EmptyState />;

  const s = student.data;
  const bal = Number(balance.data?.balance ?? 0);
  const c = contract.data;
  // deno-lint-ignore no-explicit-any
  const klass = (s as any).classes;
  const discount = c?.discount_kind
    ? { kind: c.discount_kind, value: c.discount_value }
    // deno-lint-ignore no-explicit-any
    : (c as any)?.discount_types
    // deno-lint-ignore no-explicit-any
    ? { kind: (c as any).discount_types.kind, value: (c as any).discount_types.value }
    : null;

  const age = ageFrom(s.birth_date);
  const months = monthsBetween(s.enrolled_on, s.left_on);
  const confirmedPayments = (payments.data ?? [])
    .filter((p) => p.status === 'confirmed');

  return (
    <>
      <div className="mb-2">
        <Link to="/oquvchilar"
              className="text-[13px] text-[var(--text-muted)] hover:underline">
          ← {t('students.title')}
        </Link>
      </div>

      <PageHeader
        title={s.full_name}
        subtitle={[
          s.class_name,
          // deno-lint-ignore no-explicit-any
          (s as any).branches?.name,
          `${t('students.paymentCode')}: ${s.payment_code}`,
        ].filter(Boolean).join(' · ')}
        actions={
          <>
            <Badge tone={s.status === 'active' ? 'ok' : s.status === 'academic_leave' ? 'warn' : 'neutral'}>
              {t(`students.status.${s.status}`)}
            </Badge>
            <Button onClick={() => setHistoryOpen(true)}>
              {t('students.history')}
            </Button>
            {mayWrite('students.manage') && (
              <Button onClick={() => setEditOpen(true)}>
                {t('common.edit')}
              </Button>
            )}
            {mayWrite('payments.create') && (
              <Button variant="accent" onClick={() => setPayOpen(true)}>
                {t('nav.payments')} +
              </Button>
            )}
          </>
        }
      />

      {/* --- Balans ------------------------------------------------- */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-lg border bg-[var(--bg)] px-4 py-3">
          <div className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
            {t('dashboard.charged')}
          </div>
          <div className="num mt-1 text-lg font-semibold">
            {money(balance.data?.charged, lang)}
          </div>
        </div>
        <div className="rounded-lg border bg-[var(--bg)] px-4 py-3">
          <div className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
            {t('dashboard.collected')}
          </div>
          <div className="num mt-1 text-lg font-semibold text-[var(--ok)]">
            {money(balance.data?.paid, lang)}
          </div>
        </div>
        <div className="rounded-lg border bg-[var(--bg)] px-4 py-3">
          <div className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
            {bal < 0 ? t('students.advance') : t('students.debt')}
          </div>
          <div className={`num mt-1 text-lg font-semibold ${
            bal > 0 ? 'text-[var(--danger)]' : bal < 0 ? 'text-[var(--ok)]' : ''}`}>
            {money(Math.abs(bal), lang)}
          </div>
        </div>
        <div className="rounded-lg border bg-[var(--bg)] px-4 py-3">
          <div className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
            {t('students.paymentsCount')}
          </div>
          <div className="num mt-1 text-lg font-semibold">
            {confirmedPayments.length}
          </div>
          {balance.data?.oldest_unpaid_due && bal > 0 && (
            <div className="mt-0.5 text-[11px] text-[var(--danger)]">
              {t('debt.overdueSince', {
                date: date(balance.data.oldest_unpaid_due, lang),
              })}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* --- To'liq ma'lumot (TZ 4.1) ------------------------- */}
        <Card
          title={t('students.info')}
          action={mayWrite('students.manage') && (
            <Button size="sm" onClick={() => setEditOpen(true)}>
              {t('common.edit')}
            </Button>
          )}
        >
          <dl className="space-y-1.5 text-[13px]">
            <Row label={t('common.fullName')} value={s.full_name} />
            <Row
              label={t('students.birthDate')}
              value={s.birth_date
                ? `${date(s.birth_date, lang)}${age !== null ? ` · ${t('students.ageN', { n: age })}` : ''}`
                : '—'}
            />
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--text-muted)]">{t('students.class')}</dt>
              <dd className="font-medium">
                {klass
                  ? (
                    <Link to={`/sinflar/${klass.id}`} className="hover:underline">
                      {klass.name}
                      <span className="ml-1 text-[11px] text-[var(--text-faint)]">
                        {klass.academic_year}
                      </span>
                    </Link>
                  )
                  : (s.class_name ?? t('cls.noClass'))}
              </dd>
            </div>
            <Row label={t('students.paymentCode')} value={s.payment_code} mono />
            <Row label={t('students.enrolledOn')}
                 value={date(s.enrolled_on, lang)} />
            <Row
              label={s.left_on ? t('students.leftOn') : t('students.studyLength')}
              value={s.left_on
                ? date(s.left_on, lang)
                : t('students.monthsN', { n: months })}
            />
            {/* deno-lint-ignore no-explicit-any */}
            <Row label={t('common.branch')}
                 value={(s as any).branches?.name ?? '—'} />
            <Row label={t('common.status')}
                 value={t(`students.status.${s.status}`)} />
          </dl>
          {s.note && (
            <div className="mt-3 rounded-md bg-[var(--bg-subtle)] px-3 py-2
              text-[13px] whitespace-pre-line">
              {s.note}
            </div>
          )}
        </Card>

        {/* --- Shartnoma (TZ 4.3) ------------------------------- */}
        <Card
          title={t('students.contract')}
          action={mayWrite('students.manage') && (
            <Button size="sm" onClick={() => setContractOpen(true)}>
              {contract.data ? t('common.edit') : t('contracts.add')}
            </Button>
          )}
        >
          {!c
            ? <EmptyState title={t('common.empty')} hint={t('students.noContract')} />
            : (
              <dl className="space-y-1.5 text-[13px]">
                <Row label={t('contracts.number')} value={c.number} />
                <Row label={t('contracts.startsOn')} value={date(c.starts_on, lang)} />
                {c.ends_on && (
                  <Row label={t('contracts.endsOn')} value={date(c.ends_on, lang)} />
                )}
                <Row label={t('contracts.tuition')}
                     value={money(c.tuition_amount, lang)} mono />
                {discount && (
                  <Row
                    label={t('contracts.discount')}
                    value={discount.kind === 'percent'
                      ? `${discount.value}%`
                      : money(discount.value, lang)}
                    mono
                  />
                )}
                <Row label={t('contracts.dueDay')} value={String(c.due_day)} />
                <Row
                  label={t('contracts.billingMonths')}
                  value={t('contracts.monthsN', { n: c.billing_months })}
                />
              </dl>
            )}
        </Card>

        {/* --- Ota-onalar (TZ 4.3.2) ---------------------------- */}
        <Card
          title={t('students.parents')}
          action={mayWrite('students.manage') && (
            <Button size="sm" onClick={() => setParentOpen(true)}>
              + {t('parents.add')}
            </Button>
          )}
        >
          {(parents.data?.length ?? 0) === 0
            ? <EmptyState title={t('common.empty')} hint={t('students.noParents')} />
            : (
              <ul className="space-y-2">
                {parents.data!.map((p, i) => {
                  // deno-lint-ignore no-explicit-any
                  const par = (p as any).parents;
                  if (!par) return null;
                  return (
                    <li key={i} className="flex items-start justify-between gap-3
                      rounded-md px-2 py-1.5 hover:bg-[var(--bg-subtle)]">
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium">
                          {par.full_name}
                          {p.is_primary && (
                            <span className="ml-1.5 text-[11px]
                              text-[var(--text-faint)]">
                              ★ {t('parents.primary')}
                            </span>
                          )}
                        </div>
                        <div className="num text-[12px] text-[var(--text-muted)]">
                          {par.phone}
                          {p.relation && ` · ${t(`parents.relation.${p.relation}`)}`}
                          {` · ${par.lang}`}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Badge tone={par.telegram_id ? 'ok' : 'neutral'}>
                          {par.telegram_id ? 'Telegram ✓' : 'Telegram —'}
                        </Badge>
                        {mayWrite('students.manage') && (
                          <>
                            <Button
                              size="sm" variant="ghost"
                              onClick={() => setEditingParent({
                                parent_id: par.id,
                                full_name: par.full_name,
                                phone: par.phone,
                                lang: par.lang,
                                relation: p.relation,
                                is_primary: p.is_primary,
                                telegram_id: par.telegram_id,
                              })}
                            >
                              {t('common.edit')}
                            </Button>
                            <button
                              type="button"
                              title={t('parents.detach')}
                              onClick={async () => {
                                const ok = await confirmDialog({
                                  title: t('parents.detach'),
                                  message: t('parents.detachConfirm', {
                                    name: par.full_name,
                                  }),
                                  warning: t('parents.detachHint'),
                                  danger: true,
                                  confirmLabel: t('parents.detach'),
                                });
                                if (ok) detachParent.mutate(par.id);
                              }}
                              className="flex h-6 w-6 items-center justify-center
                                rounded text-[var(--text-faint)]
                                hover:bg-[var(--danger-bg)] hover:text-[var(--danger)]"
                            >
                              ✕
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
        </Card>

        {/* --- Xizmatlar (TZ 4.4.2) ----------------------------- */}
        <Card
          title={t('students.services')}
          action={mayWrite('services.manage') && (
            <Button size="sm" onClick={() => setServiceOpen(true)}>
              + {t('services.assign')}
            </Button>
          )}
        >
          {(services.data?.length ?? 0) === 0
            ? <EmptyState title={t('common.empty')} hint={t('students.noServices')} />
            : (
              <ul className="space-y-2">
                {services.data!.map((ss) => {
                  // deno-lint-ignore no-explicit-any
                  const sv = (ss as any).services;
                  const active = !ss.ends_on || ss.ends_on >= isoDate();
                  return (
                    <li key={ss.id} className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium">{sv?.name}</div>
                        <div className="text-[12px] text-[var(--text-muted)]">
                          {t(`services.type.${sv?.billing_type}`)} ·{' '}
                          {date(ss.starts_on, lang)}
                          {ss.ends_on && ` — ${date(ss.ends_on, lang)}`}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Badge tone={active ? 'ok' : 'neutral'}>
                          {active ? t('common.active') : t('common.inactive')}
                        </Badge>
                        {active && mayWrite('services.manage') && (
                          <button
                            type="button"
                            title={t('services.unassign')}
                            onClick={async () => {
                              const ok = await confirmDialog({
                                title: t('services.unassign'),
                                message: t('services.unassignConfirm', {
                                  name: sv?.name ?? '',
                                }),
                                danger: true,
                              });
                              if (ok) unassign.mutate(ss.id);
                            }}
                            className="flex h-6 w-6 items-center justify-center rounded
                              text-[var(--text-faint)] hover:bg-[var(--danger-bg)]
                              hover:text-[var(--danger)]"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
        </Card>
      </div>

      {/* --- To'lov tarixi — TO'LIQ (TZ 4.7) -------------------- */}
      <Card
        title={`${t('students.paymentHistory')} · ${(payments.data ?? []).length}`}
        className="mt-4"
        padded={false}
        action={(payments.data?.length ?? 0) > 10 && (
          <Button size="sm" variant="ghost"
                  onClick={() => setAllPayments((v) => !v)}>
            {allPayments
              ? t('common.showLess')
              : t('common.showAll', { count: (payments.data ?? []).length })}
          </Button>
        )}
      >
        {(payments.data?.length ?? 0) === 0
          ? <EmptyState title={t('students.noPayments')} hint="" />
          : (
            <Table>
              <thead>
                <tr>
                  <Th>{t('common.date')}</Th>
                  <Th>{t('pay.tab.all')}</Th>
                  <Th>{t('pay.receipt')}</Th>
                  <Th>{t('common.status')}</Th>
                  <Th align="right">{t('common.amount')}</Th>
                  <Th align="right">{t('common.actions')}</Th>
                </tr>
              </thead>
              <tbody>
                {payList.map((p) => {
                  // deno-lint-ignore no-explicit-any
                  const code = (p as any).cash_receipts?.[0]?.receipt_code;
                  return (
                    <Tr key={p.id}
                        className={p.status !== 'confirmed' ? 'opacity-60' : ''}>
                      <Td mono className="whitespace-nowrap">
                        {date(p.paid_on, lang)}
                      </Td>
                      <Td>
                        {p.channel === 'cash' ? '💵' : p.channel === 'bank' ? '🏦' : '📸'}
                        {' '}{t(`pay.channel.${p.channel}`)}
                        {p.note && (
                          <div className="text-[11px] text-[var(--text-faint)]">
                            {p.note}
                          </div>
                        )}
                      </Td>
                      <Td mono className="text-[var(--text-muted)]">
                        {code ?? '—'}
                      </Td>
                      <Td>
                        <Badge tone={p.status === 'confirmed' ? 'ok'
                          : p.status === 'pending' ? 'warn' : 'neutral'}>
                          {t(`pay.status.${p.status}`)}
                        </Badge>
                      </Td>
                      <Td align="right" mono>{money(p.amount, lang)}</Td>
                      <Td align="right">
                        <div className="flex justify-end gap-1">
                          {code && (
                            <Button size="sm" variant="ghost"
                                    title={t('pay.reprint')}
                                    onClick={() => openReceipt(p)}>
                              🖨
                            </Button>
                          )}
                          {p.status === 'confirmed' && mayWrite('payments.create') && (
                            <Button size="sm" variant="ghost"
                                    onClick={() => setEditingPayment(p)}>
                              {t('common.edit')}
                            </Button>
                          )}
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
      </Card>

      {/* --- Yuborilgan cheklar (TZ 4.7.3) ---------------------- */}
      {(proofs.data?.length ?? 0) > 0 && (
        <Card title={t('students.proofHistory')} className="mt-4" padded={false}>
          <Table>
            <thead>
              <tr>
                <Th>{t('common.date')}</Th>
                <Th align="right">{t('pay.claimedAmount')}</Th>
                <Th>{t('common.status')}</Th>
                <Th align="right">{t('common.actions')}</Th>
              </tr>
            </thead>
            <tbody>
              {proofs.data!.map((pr) => (
                <Tr key={pr.id}>
                  <Td mono className="whitespace-nowrap">
                    {dateTime(pr.submitted_at, lang)}
                  </Td>
                  <Td align="right" mono>
                    {pr.amount_claimed ? money(pr.amount_claimed, lang) : '—'}
                  </Td>
                  <Td>
                    <Badge tone={pr.status === 'confirmed' ? 'ok'
                      : pr.status === 'pending' ? 'warn' : 'danger'}>
                      {t(`pay.status.${pr.status}`)}
                    </Badge>
                    {pr.reject_reason && (
                      <div className="text-[11px] text-[var(--text-faint)]">
                        {pr.reject_reason}
                      </div>
                    )}
                  </Td>
                  <Td align="right">
                    {pr.file_path && <ProofImageButton path={pr.file_path} />}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {/* --- Hisoblanma tarixi (TZ 4.6.2) ----------------------- */}
      <Card title={t('nav.invoices')} className="mt-4" padded={false}>
        {(invoices.data?.length ?? 0) === 0
          ? <EmptyState title={t('common.empty')} hint="" />
          : (
            <Table>
              <thead>
                <tr>
                  <Th>{t('common.period')}</Th>
                  <Th>{t('common.status')}</Th>
                  <Th>{t('contracts.dueDay')}</Th>
                  <Th align="right">{t('common.total')}</Th>
                  <Th align="right">{t('common.actions')}</Th>
                </tr>
              </thead>
              <tbody>
                {invoices.data!.map((inv) => (
                  <Tr key={inv.invoice_id}>
                    <Td>{periodLabel(String(inv.period), lang)}</Td>
                    <Td>
                      <Badge tone={inv.status === 'approved'
                        ? 'ok' : inv.has_preliminary ? 'warn' : 'neutral'}>
                        {t(`inv.status.${inv.status}`)}
                        {inv.has_preliminary ? ` · ${t('inv.preliminary')}` : ''}
                      </Badge>
                    </Td>
                    <Td mono>{date(inv.due_date, lang)}</Td>
                    <Td align="right" mono><Money value={inv.total} bold /></Td>
                    <Td align="right">
                      <Button size="sm" variant="ghost"
                              onClick={() => setOpenInvoice(inv.invoice_id)}>
                        {t('inv.showLines')}
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
      </Card>

      {/* =============== OYNALAR =============== */}

      <StudentEditModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        student={s}
        key={`edit-${s.id}-${s.status}-${s.branch_id}`}
      />

      <ReceiptModal data={receipt} onClose={() => setReceipt(null)} />

      <ContractModal
        open={contractOpen}
        onClose={() => setContractOpen(false)}
        studentId={id!}
        // deno-lint-ignore no-explicit-any
        existing={(contract.data as any) ?? null}
        key={contract.data?.id ?? 'new'}
      />

      <ParentModal
        open={parentOpen}
        onClose={() => setParentOpen(false)}
        studentId={id!}
      />

      {editingParent && (
        <ParentModal
          key={editingParent.parent_id}
          open
          onClose={() => setEditingParent(null)}
          studentId={id!}
          existing={editingParent}
        />
      )}

      <ServiceModal
        open={serviceOpen}
        onClose={() => setServiceOpen(false)}
        studentId={id!}
        branchId={s.branch_id}
        assignedIds={(services.data ?? [])
          .filter((x) => !x.ends_on || x.ends_on >= isoDate())
          // deno-lint-ignore no-explicit-any
          .map((x) => (x as any).services?.id)
          .filter(Boolean)}
      />

      <CashPaymentModal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        studentName={s.full_name}
        suggested={bal > 0 ? bal : 0}
        onSubmit={(v) => pay.mutate(v)}
        busy={pay.isPending}
        error={pay.error ? (pay.error as Error).message : null}
        result={pay.data ?? null}
        schoolName={profile?.school_name ?? ''}
      />

      {editingPayment && (
        <EditPaymentInline
          key={editingPayment.id}
          payment={editingPayment}
          studentName={s.full_name}
          onClose={() => setEditingPayment(null)}
          onSubmit={(v) => editPayment.mutate({ id: editingPayment.id, ...v })}
          busy={editPayment.isPending}
          error={editPayment.error ? (editPayment.error as Error).message : null}
        />
      )}

      <Modal
        open={!!openInvoice}
        title={t('inv.lines')}
        onClose={() => setOpenInvoice(null)}
        wide
        footer={<Button onClick={() => setOpenInvoice(null)}>{t('common.close')}</Button>}
      >
        {invoiceLines.isLoading
          ? <Loading />
          : (invoiceLines.data?.length ?? 0) === 0
          ? <EmptyState />
          : (
            <Table>
              <thead>
                <tr>
                  <Th>{t('inv.line')}</Th>
                  <Th align="right">{t('inv.qty')}</Th>
                  <Th align="right">{t('inv.unitPrice')}</Th>
                  <Th align="right">{t('common.amount')}</Th>
                </tr>
              </thead>
              <tbody>
                {invoiceLines.data!.map((l) => (
                  <Tr key={l.id}>
                    <Td>
                      {l.description}
                      <span className="ml-1.5 text-[11px] text-[var(--text-faint)]">
                        {t(`inv.kind.${l.kind}`)}
                      </span>
                    </Td>
                    <Td align="right" mono>{l.quantity}</Td>
                    <Td align="right" mono>{money(l.unit_price, lang)}</Td>
                    <Td align="right" mono>
                      <Money value={l.amount} bold={Number(l.amount) < 0} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-[var(--bg-subtle)] font-semibold">
                  <Td colSpan={3}>{t('common.total')}</Td>
                  <Td align="right" mono>
                    {money(
                      invoiceLines.data!.reduce((a, l) => a + Number(l.amount), 0),
                      lang,
                    )}
                  </Td>
                </tr>
              </tfoot>
            </Table>
          )}
      </Modal>

      <Modal
        open={historyOpen}
        title={t('students.history')}
        onClose={() => setHistoryOpen(false)}
        wide
        footer={<Button onClick={() => setHistoryOpen(false)}>{t('common.close')}</Button>}
      >
        {history.isLoading
          ? <Loading />
          : history.error
          ? <Notice tone="danger">{(history.error as Error).message}</Notice>
          : (history.data?.length ?? 0) === 0
          ? <EmptyState title={t('students.noHistory')} hint="" />
          : (
            <ol className="space-y-2">
              {history.data!.map((h, i) => (
                <li key={i} className="flex gap-3 border-b border-[var(--border-soft)]
                  pb-2 last:border-0">
                  <div className="w-32 shrink-0 text-[12px] text-[var(--text-muted)]">
                    {dateTime(h.at, lang)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px]">
                      <span className="font-medium">
                        {t(`audit.table.${h.table_name}`)}
                      </span>
                      {' · '}
                      <span className={h.action === 'DELETE'
                        ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]'}>
                        {t(`audit.action.${h.action}`)}
                      </span>
                      {h.summary && (
                        <span className="num ml-1.5 font-medium">{h.summary}</span>
                      )}
                    </div>
                    {h.changed_keys && h.changed_keys.length > 0 && (
                      <div className="text-[11px] text-[var(--text-faint)]">
                        {h.changed_keys.join(', ')}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 text-[12px] text-[var(--text-muted)]">
                    {h.user_name ?? t('audit.system')}
                    {h.impersonated && ' ⚠'}
                  </div>
                </li>
              ))}
            </ol>
          )}
      </Modal>
    </>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-[var(--text-muted)]">{label}</dt>
      <dd className={mono ? 'num font-medium' : 'font-medium'}>{value}</dd>
    </div>
  );
}

/** Chek rasmini vaqtinchalik havola orqali ochadi (TZ 5.5.8). */
function ProofImageButton({ path }: { path: string }) {
  const t = useT();
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (url) {
    return (
      <a href={url} target="_blank" rel="noreferrer"
         className="text-[12px] text-brand-700 hover:underline">
        {t('pay.openFullSize')} ↗
      </a>
    );
  }

  return (
    <Button
      size="sm" variant="ghost" disabled={busy}
      onClick={async () => {
        setBusy(true);
        const { data } = await supabase.storage
          .from('receipts').createSignedUrl(path, 300);
        setBusy(false);
        if (data?.signedUrl) {
          setUrl(data.signedUrl);
          globalThis.open(data.signedUrl, '_blank', 'noopener');
        }
      }}
    >
      {t('pay.viewImage')}
    </Button>
  );
}

// ---------------------------------------------------------------------
//  To'lovni tahrirlash (kartochka ichidan)
// ---------------------------------------------------------------------

function EditPaymentInline({
  payment, studentName, onClose, onSubmit, busy, error,
}: {
  // deno-lint-ignore no-explicit-any
  payment: any;
  studentName: string;
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
  const code = payment.cash_receipts?.[0]?.receipt_code;

  return (
    <Modal
      open
      title={`${t('pay.edit')} — ${studentName}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="primary" form="edit-pay-card" type="submit"
            disabled={busy || !changed || Number(amount) <= 0
              || reason.trim().length < 5}
          >
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <form
        id="edit-pay-card"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          onSubmit({ amount: Number(amount), paid_on: paidOn, note, reason });
        }}
        className="space-y-3"
      >
        <div className="rounded-md bg-[var(--bg-subtle)] px-3 py-2 text-[13px]
          text-[var(--text-muted)]">
          {t('pay.wasAmount', {
            amount: money(payment.amount, lang),
            date: date(payment.paid_on, lang),
          })}
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
          <Input value={reason} onChange={(e) => setReason(e.target.value)} required />
        </Field>

        {amountChanged && code && (
          <Notice tone="warn">{t('pay.receiptWarning', { code })}</Notice>
        )}
        {amountChanged && <Notice tone="neutral">{t('pay.editNotify')}</Notice>}
        {error && <Notice tone="danger">{error}</Notice>}
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------
//  Kassa to'lovi (TZ 4.7.1)
// ---------------------------------------------------------------------

function CashPaymentModal({
  open, onClose, studentName, suggested, onSubmit, busy, error, result, schoolName,
}: {
  open: boolean;
  onClose: () => void;
  studentName: string;
  suggested: number;
  onSubmit: (v: {
    amount: number; paid_on: string; note: string; method_id: string;
  }) => void;
  busy: boolean;
  error: string | null;
  result: {
    receipt_code: string; balance: number; method_name: string;
  } | null;
  schoolName: string;
}) {
  const t = useT();
  const { lang } = useI18n();
  const [amount, setAmount] = useState(String(suggested || ''));
  const [paidOn, setPaidOn] = useState(isoDate());
  const [note, setNote] = useState('');

  //  Standart tanlov — naqd. Kassaga kelgan to'lovlarning ko'pchiligi
  //  shunday, ya'ni kassir odatda hech narsa bosmaydi.
  const methods = usePaymentMethods();
  const [methodId, setMethodId] = useState('');
  const method = methodId || defaultMethodId(methods.data);

  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit({
      amount: Number(amount), paid_on: paidOn, note, method_id: method,
    });
  }

  // To'lovdan keyin kvitansiya ko'rsatiladi (TZ 4.7.1.2).
  if (result) {
    return (
      <Modal open={open} title={t('nav.payments')} onClose={onClose}
             footer={<Button variant="primary" onClick={onClose}>{t('common.close')}</Button>}>
        <div className="space-y-3 text-center">
          <div className="text-3xl">✅</div>
          <div className="text-sm">{schoolName}</div>
          <div className="text-[13px] text-[var(--text-muted)]">{studentName}</div>
          <div className="num text-2xl font-semibold">{money(amount, lang)}</div>
          {result.method_name && (
            <div className="text-[13px] text-[var(--text-muted)]">
              {result.method_name}
            </div>
          )}
          <div className="rounded-md bg-[var(--bg-inset)] px-3 py-2">
            <div className="text-[11px] uppercase text-[var(--text-muted)]">
              {t('pay.receipt')}
            </div>
            <div className="num text-lg font-semibold">{result.receipt_code}</div>
          </div>
          <div className="text-[13px] text-[var(--text-muted)]">
            {t('students.balance')}: <Money value={result.balance} colored />
          </div>
          <Notice tone="neutral">{t('receipt.sentToParent')}</Notice>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      title={`${t('nav.payments')} — ${studentName}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="accent" form="cash-pay" type="submit"
                  disabled={busy || !amount || Number(amount) <= 0}>
            {busy ? t('common.saving') : t('common.confirm')}
          </Button>
        </>
      }
    >
      <form id="cash-pay" onSubmit={submit} className="space-y-3">
        <Field label={t('common.amount')} required>
          <MoneyInput value={amount} onChange={(e) => setAmount(e.target.value)}
                      autoFocus required />
        </Field>
        <Field label={t('payMethod.label')} hint={t('payMethod.hint')} required>
          <PaymentMethodPicker value={method} onChange={setMethodId} />
        </Field>
        <Field label={t('common.date')} required>
          <Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)}
                 required />
        </Field>
        <Field label={t('common.note')}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
      </form>
    </Modal>
  );
}
