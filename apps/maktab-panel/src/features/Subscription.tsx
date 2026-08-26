// =====================================================================
//  Obuna va to'lov (maktab tomoni).
//
//  Direktor shu yerda ko'radi:
//    · qancha to'laydi va NEGA shuncha — narx tarkibi ochiq
//    · qachon to'lashi kerak va necha kun qolgan
//    · hisob-fakturalar tarixi
//    · yuborgan cheklari va ularning holati
//
//  Va shu yerdan CHEK YUBORADI: rasm yoki PDF yuklanadi, summa va
//  sana kiritiladi. Chek yuborilgach `pending` holatda turadi va
//  obunaga TA'SIR QILMAYDI — faqat ijrochi tasdiqlagach uzayadi.
//  Bu ota-ona cheki bilan bir xil qoida (TZ 4.7.3).
//
//  MUHIM: bu sahifa BLOKLANGAN maktabda ham ochiladi. To'lovni
//  bildirish yo'li yopilsa, maktab bloklangan holatdan chiqa
//  olmaydi — bu esa tuzoq bo'lardi.
// =====================================================================

import { type FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n, useT } from '@/i18n';
import { date, money } from '@/lib/format';
import {
  Badge, Button, Card, Field, Input, Loading, Modal, Money, Notice,
  PageHeader, Select, Table, Td, Th, Tr,
} from '@/ui';
import { useToast } from '@/ui/Feedback';

export default function Subscription() {
  const t = useT();
  const { lang } = useI18n();
  const { profile, can } = useAuth();
  const qc = useQueryClient();
  const [paying, setPaying] = useState(false);

  const schoolId = profile?.school_id ?? '';

  const price = useQuery({
    queryKey: ['my-price', schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('school_price', {
        p_school_id: schoolId,
      });
      if (error) throw error;
      return data as Record<string, number | boolean>;
    },
  });

  const sub = useQuery({
    queryKey: ['my-subscription', schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('school_subscriptions')
        .select('*, plans(name)')
        .eq('school_id', schoolId)
        .neq('status', 'cancelled')
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const invoices = useQuery({
    queryKey: ['my-invoices', schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subscription_invoices')
        .select('*')
        .order('period', { ascending: false })
        .limit(24);
      if (error) throw error;
      return data ?? [];
    },
  });

  const payments = useQuery({
    queryKey: ['my-sub-payments', schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subscription_payments')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      return data ?? [];
    },
  });

  const overdue = useMemo(() => {
    const d = sub.data?.next_payment_date as string | undefined;
    if (!d) return null;
    return Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
  }, [sub.data]);

  const unpaid = useMemo(
    () => (invoices.data ?? [])
      .filter((i) => i.status === 'unpaid' || i.status === 'partial')
      .reduce((s, i) => s + (Number(i.total_amount) - Number(i.paid_amount)), 0),
    [invoices.data],
  );

  if (sub.isLoading || price.isLoading) return <Loading />;

  const p = price.data;
  const status = profile?.school_status ?? '';

  return (
    <>
      <PageHeader
        title={t('sub.title')}
        subtitle={t('sub.subtitle')}
        actions={can('users.manage') && (
          <Button variant="primary" onClick={() => setPaying(true)}>
            {t('sub.sendReceipt')}
          </Button>
        )}
      />

      {/* --- Holat ogohlantirishlari ------------------------------- */}
      {status === 'suspended' && (
        <Notice tone="danger">{t('sub.suspendedNotice')}</Notice>
      )}
      {status === 'restricted' && (
        <Notice tone="warn">{t('sub.restrictedNotice')}</Notice>
      )}
      {status === 'active' && overdue !== null && overdue >= 0 && (
        <Notice tone="warn">
          {t('sub.overdueNotice', { days: String(overdue) })}
        </Notice>
      )}

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {/* --- Obuna holati --------------------------------------- */}
        <Card title={t('sub.status')}>
          <div className="space-y-1.5 text-[13px]">
            <div className="flex justify-between border-b py-1.5">
              <span className="text-[var(--text-muted)]">{t('sub.plan')}</span>
              <span className="font-medium">
                {(sub.data?.plans as unknown as { name: string } | null)?.name ?? '—'}
              </span>
            </div>
            <div className="flex justify-between border-b py-1.5">
              <span className="text-[var(--text-muted)]">{t('sub.monthly')}</span>
              {/*  JORIY hisob ko'rsatiladi, saqlangan qiymat emas.
                   Ilgari bu yerda `monthly_amount` turardi — u maktab
                   yaratilganda bir marta yozilgan va keyin hech qachon
                   yangilanmagan. Natijada yon ustunda "Oylik jami
                   500 000" turganda bu yerda 900 000 ko'rinardi.
                   To'lov masalasida ikki xil raqam — yo'l qo'yib
                   bo'lmaydigan hol. */}
              <Money
                value={Number(p?.monthly_total ?? sub.data?.monthly_amount ?? 0)}
                bold
              />
            </div>
            <div className="flex justify-between border-b py-1.5">
              <span className="text-[var(--text-muted)]">{t('sub.nextPayment')}</span>
              <span className={overdue !== null && overdue >= 0
                ? 'font-semibold text-[var(--danger)]' : 'font-medium'}>
                {sub.data?.next_payment_date
                  ? date(sub.data.next_payment_date as string, lang) : '—'}
              </span>
            </div>
            {sub.data?.trial_ends_at && (
              <div className="flex justify-between border-b py-1.5">
                <span className="text-[var(--text-muted)]">{t('sub.trialEnds')}</span>
                <span className="font-medium">
                  {date(sub.data.trial_ends_at as string, lang)}
                </span>
              </div>
            )}
            <div className="flex justify-between border-b py-1.5">
              <span className="text-[var(--text-muted)]">{t('sub.lastPaid')}</span>
              <span className="font-medium">
                {sub.data?.last_paid_at
                  ? date(sub.data.last_paid_at as string, lang) : '—'}
              </span>
            </div>
            <div className="flex justify-between py-1.5">
              <span className="text-[var(--text-muted)]">{t('sub.unpaid')}</span>
              <Money value={unpaid} colored bold />
            </div>
          </div>
        </Card>

        {/* --- Narx tarkibi. ATAYLAB OCHIQ -------------------------
             Direktor nima uchun qancha to'layotganini mustaqil
             tekshira olishi kerak — "qayerdan chiqdi bu raqam"
             degan savol qolmasin. */}
        <Card title={t('sub.priceBreakdown')}>
          {p && (
            <div className="space-y-1.5 text-[13px]">
              <div className="flex justify-between border-b py-1.5">
                <span className="text-[var(--text-muted)]">{t('sub.priceBase')}</span>
                <span className="num">{money(p.base_amount as number, lang)}</span>
              </div>
              <div className="flex justify-between border-b py-1.5">
                <span className="text-[var(--text-muted)]">
                  {t('sub.priceBranches', { count: String(p.branches_extra) })}
                </span>
                <span className="num">{money(p.branches_amount as number, lang)}</span>
              </div>
              <div className="flex justify-between border-b py-1.5">
                <span className="text-[var(--text-muted)]">
                  {t('sub.priceStudents', {
                    extra: String(p.students_extra),
                    steps: String(p.students_extra_steps),
                  })}
                </span>
                <span className="num">{money(p.students_amount as number, lang)}</span>
              </div>
              <div className="flex justify-between py-1.5 font-semibold">
                <span>{t('sub.priceTotal')}</span>
                <span className="num">{money(p.monthly_total as number, lang)}</span>
              </div>

              <p className="mt-2 text-[11px] text-[var(--text-faint)]">
                {t('sub.priceHint', {
                  branches: String(p.branches_count),
                  students: String(p.students_count),
                  included: String(p.students_included),
                })}
              </p>
            </div>
          )}
        </Card>
      </div>

      {/* --- Hisob-fakturalar ------------------------------------- */}
      <Card title={t('sub.invoices')} className="mt-3" padded={false}>
        {(invoices.data ?? []).length === 0 ? (
          <p className="p-4 text-[13px] text-[var(--text-muted)]">{t('sub.noInvoices')}</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t('sub.period')}</Th>
                <Th>{t('sub.due')}</Th>
                <Th align="right">{t('sub.total')}</Th>
                <Th align="right">{t('sub.paid')}</Th>
                <Th align="right">{t('sub.left')}</Th>
                <Th>{t('sub.invStatus')}</Th>
              </tr>
            </thead>
            <tbody>
              {(invoices.data ?? []).map((inv) => (
                <Tr key={inv.id as string}>
                  <Td mono>{String(inv.period).slice(0, 7)}</Td>
                  <Td mono>{date(inv.due_date as string, lang)}</Td>
                  <Td align="right"><Money value={inv.total_amount as number} /></Td>
                  <Td align="right"><Money value={inv.paid_amount as number} /></Td>
                  <Td align="right">
                    <Money
                      value={Number(inv.total_amount) - Number(inv.paid_amount)}
                      colored
                    />
                  </Td>
                  <Td>
                    <Badge tone={
                      inv.status === 'paid' ? 'ok'
                      : inv.status === 'partial' ? 'warn'
                      : inv.status === 'void' ? 'neutral' : 'danger'
                    }>
                      {t(`sub.inv.${inv.status}`)}
                    </Badge>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* --- Yuborilgan cheklar ----------------------------------- */}
      <Card title={t('sub.myPayments')} className="mt-3" padded={false}>
        {(payments.data ?? []).length === 0 ? (
          <p className="p-4 text-[13px] text-[var(--text-muted)]">{t('sub.noPayments')}</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t('sub.sentAt')}</Th>
                <Th align="right">{t('sub.amount')}</Th>
                <Th>{t('sub.paidOn')}</Th>
                <Th align="right">{t('sub.months')}</Th>
                <Th>{t('sub.payStatus')}</Th>
              </tr>
            </thead>
            <tbody>
              {(payments.data ?? []).map((pay) => (
                <Tr key={pay.id as string}>
                  <Td mono>{date(pay.created_at as string, lang)}</Td>
                  <Td align="right"><Money value={pay.amount as number} /></Td>
                  <Td mono>{date(pay.paid_on as string, lang)}</Td>
                  <Td align="right" mono>{pay.months as number}</Td>
                  <Td>
                    <Badge tone={
                      pay.status === 'confirmed' ? 'ok'
                      : pay.status === 'rejected' ? 'danger' : 'warn'
                    }>
                      {t(`sub.pay.${pay.status}`)}
                    </Badge>
                    {pay.reject_reason && (
                      <span className="ml-1 text-[11px] text-[var(--danger)]">
                        {pay.reject_reason as string}
                      </span>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {paying && (
        <PayModal
          schoolId={schoolId}
          suggested={Number(p?.monthly_total ?? 0)}
          onClose={() => setPaying(false)}
          onDone={() => qc.invalidateQueries()}
        />
      )}
    </>
  );
}

// =====================================================================
//  Chek yuborish.
//
//  Fayl AVVAL yuklanadi, keyin RPC chaqiriladi. Teskarisi bo'lsa
//  to'lov yozuvi cheksiz qolib ketishi mumkin — ijrochi nimani
//  tasdiqlashini bilmaydi.
// =====================================================================

function PayModal({ schoolId, suggested, onClose, onDone }: {
  schoolId: string; suggested: number; onClose: () => void; onDone: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const [amount, setAmount] = useState(String(suggested || ''));
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [months, setMonths] = useState(1);
  const [method, setMethod] = useState('bank');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);

  const send = useMutation({
    mutationFn: async () => {
      let path: string | null = null;

      if (file) {
        // Yo'l naqshi butun loyihada bir xil: {school_id}/... —
        // storage siyosati birinchi bo'lakni maktab bilan solishtiradi.
        const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
        const year = new Date().getFullYear();
        path = `${schoolId}/${year}/${crypto.randomUUID()}.${ext}`;

        const { error: upErr } = await supabase.storage
          .from('subscription-receipts')
          .upload(path, file, { contentType: file.type, upsert: false });
        if (upErr) throw upErr;
      }

      const { data, error } = await supabase.rpc('submit_subscription_payment', {
        p_amount: Number(amount),
        p_paid_on: paidOn,
        p_months: months,
        p_method: method,
        p_file_path: path ?? undefined,
        p_note: note.trim() || undefined,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => { toast.ok(t('sub.sent')); onDone(); onClose(); },
    onError: (e) => toast.error((e as Error).message),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (Number(amount) > 0) send.mutate();
  }

  return (
    <Modal open title={t('sub.sendReceipt')} onClose={onClose} footer={
      <>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          variant="primary"
          disabled={!Number(amount) || send.isPending}
          onClick={() => send.mutate()}
        >
          {send.isPending ? t('sub.sending') : t('sub.send')}
        </Button>
      </>
    }>
      <form onSubmit={onSubmit} className="space-y-3">
        <Notice tone="brand">{t('sub.sendHint')}</Notice>

        <Field label={t('sub.amount')} required>
          <Input
            value={amount}
            inputMode="numeric"
            onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
            required
          />
        </Field>

        <Field label={t('sub.paidOn')} required>
          <Input type="date" value={paidOn} max={new Date().toISOString().slice(0, 10)}
                 onChange={(e) => setPaidOn(e.target.value)} required />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('sub.months')} hint={t('sub.monthsHint')}>
            <Select value={months} onChange={(e) => setMonths(Number(e.target.value))}>
              {[1, 2, 3, 6, 12].map((m) => <option key={m} value={m}>{m}</option>)}
            </Select>
          </Field>
          <Field label={t('sub.method')}>
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="bank">{t('sub.method.bank')}</option>
              <option value="cash">{t('sub.method.cash')}</option>
              <option value="card">{t('sub.method.card')}</option>
              <option value="other">{t('sub.method.other')}</option>
            </Select>
          </Field>
        </div>

        <Field label={t('sub.file')} hint={t('sub.fileHint')}>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full rounded-md border bg-[var(--bg)] px-2.5 py-1.5 text-sm"
          />
        </Field>

        <Field label={t('sub.note')}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}
