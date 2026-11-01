// =====================================================================
//  Tez to'lov — kassadagi eng ko'p takrorlanadigan ish uchun.
//
//  Ilgari to'lov qabul qilish uchun: O'quvchilar → qidirish → kartochka
//  → "To'lov" — to'rt sahifa. Endi istalgan joydan bitta tugma:
//  ism, telefon yoki to'lov kodini yozasiz → o'quvchi qarzi bilan
//  chiqadi → summa qarzga teng holda tayyor → "Qabul qilish".
//
//  To'lovning o'zi o'quvchi kartochkasidagi bilan AYNAN bir xil yo'l
//  (`submitStudentPayment`) — ikki xil mantiq yo'q.
// =====================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useT } from '@/i18n';
import { money } from '@/lib/format';
import { Badge, Button, Input, Modal, Spinner } from '@/ui';
import { onQuickPay, openQuickPay, type QuickPayPreset } from '@/lib/quickPayBus';
import { CashPaymentModal } from './StudentCard';
import { ReceiptModal, type ReceiptData } from './Receipt';
import { submitStudentPayment, type StudentPaymentInput } from '@/lib/studentPayment';

interface Hit {
  student_id: string;
  full_name: string;
  class_name: string | null;
  payment_code: string | null;
  status: string;
  balance: number;
  branch_id: string;
}

/** Qidiruv matnini xavfsiz `ilike` naqshiga aylantiradi. */
function pattern(q: string): string {
  return `%${q.replace(/[%_,()]/g, ' ').trim()}%`;
}

export function QuickPay({ open, onClose, preset }: { open: boolean; onClose: () => void; preset?: QuickPayPreset | null }) {
  const t = useT();
  const qc = useQueryClient();
  const { profile, branchId } = useAuth();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Hit | null>(null);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setPicked(preset ? { ...preset, status: 'active', branch_id: '' } : null);
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open, preset]);

  const term = q.trim();
  const search = useQuery({
    queryKey: ['quickpay-search', term, branchId ?? null],
    enabled: open && term.length >= 2,
    queryFn: async () => {
      const p = pattern(term);
      let query = supabase
        .from('v_student_balances')
        .select('student_id, full_name, class_name, payment_code, status, balance, branch_id')
        .or(`full_name.ilike.${p},payment_code.ilike.${p}`)
        .neq('status', 'expelled')
        .order('balance', { ascending: false })
        .limit(12);
      if (branchId) query = query.eq('branch_id', branchId);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as Hit[];
    },
  });

  //  Telefon raqami bo'yicha: ota-onaning raqami orqali farzandlar.
  const digits = term.replace(/\D/g, '');
  const byPhone = useQuery({
    queryKey: ['quickpay-phone', digits],
    enabled: open && digits.length >= 4,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('parents')
        .select('student_parents(student_id)')
        .ilike('phone', `%${digits}%`)
        .limit(10);
      if (error) throw error;
      const ids = (data ?? []).flatMap((p: any) => (p.student_parents ?? []).map((x: any) => x.student_id));
      if (ids.length === 0) return [] as Hit[];
      const { data: rows, error: e2 } = await supabase
        .from('v_student_balances')
        .select('student_id, full_name, class_name, payment_code, status, balance, branch_id')
        .in('student_id', ids);
      if (e2) throw e2;
      return (rows ?? []) as unknown as Hit[];
    },
  });

  const hits = useMemo(() => {
    const seen = new Set<string>();
    return [...(byPhone.data ?? []), ...(search.data ?? [])].filter((h) => {
      if (seen.has(h.student_id)) return false;
      seen.add(h.student_id);
      return true;
    });
  }, [search.data, byPhone.data]);

  const pay = useMutation({
    mutationFn: (v: StudentPaymentInput) => submitStudentPayment(picked!.student_id, v),
    onSuccess: (res, vars) => {
      qc.invalidateQueries({ queryKey: ['students'] });
      qc.invalidateQueries({ queryKey: ['student-balance', picked!.student_id] });
      qc.invalidateQueries({ queryKey: ['student-payments', picked!.student_id] });
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['debts'] });
      qc.invalidateQueries({ queryKey: ['advances'] });
      qc.invalidateQueries({ queryKey: ['quickpay-search'] });
      setReceipt({
        receipt_code: res.receipt_code,
        amount: vars.amount,
        paid_on: vars.paid_on,
        student_name: picked!.full_name,
        student_class: picked!.class_name,
        payment_code: picked!.payment_code,
        balance: res.balance,
        cashier: profile?.full_name,
        school_name: profile?.school_name ?? '',
        method_name: res.method_name,
      });
      setPicked(null);
    },
  });

  if (receipt) {
    return (
      <ReceiptModal
        data={receipt}
        onClose={() => {
          setReceipt(null);
          onClose();
        }}
      />
    );
  }

  if (picked) {
    return (
      <CashPaymentModal
        open
        onClose={() => (preset ? onClose() : setPicked(null))}
        studentId={picked.student_id}
        studentName={`${picked.full_name}${picked.class_name ? ` · ${picked.class_name}` : ''}`}
        suggested={picked.balance > 0 ? Number(picked.balance) : 0}
        onSubmit={(v) => pay.mutate(v)}
        busy={pay.isPending}
        error={pay.error ? (pay.error as Error).message : null}
      />
    );
  }

  const loading = (search.isFetching || byPhone.isFetching) && hits.length === 0;

  return (
    <Modal open={open} title={t('quickpay.title')} onClose={onClose}>
      <Input
        ref={inputRef}
        value={q}
        placeholder={t('quickpay.search')}
        onChange={(e) => {
          setQ(e.target.value);
          setCursor(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setCursor((c) => Math.min(c + 1, Math.max(0, hits.length - 1)));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setCursor((c) => Math.max(0, c - 1));
          } else if (e.key === 'Enter' && hits[cursor]) {
            e.preventDefault();
            setPicked(hits[cursor]);
          }
        }}
        autoComplete="off"
        inputMode="search"
      />
      <div className="mt-3 min-h-[120px]">
        {term.length < 2 ? (
          <p className="text-[13px] text-[var(--text-muted)]">{t('quickpay.hint')}</p>
        ) : loading ? (
          <div className="flex justify-center py-6"><Spinner /></div>
        ) : hits.length === 0 ? (
          <p className="text-[13px] text-[var(--text-muted)]">{t('quickpay.notFound')}</p>
        ) : (
          <ul className="space-y-1.5">
            {hits.map((h, i) => {
              const debt = Number(h.balance);
              return (
                <li key={h.student_id}>
                  <button
                    type="button"
                    onClick={() => setPicked(h)}
                    onMouseEnter={() => setCursor(i)}
                    className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5
                      text-left transition-colors
                      ${i === cursor ? 'border-[var(--sel-border)] bg-[var(--sel-bg)]' : 'border-[var(--border)] hover:bg-[var(--bg-subtle)]'}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-medium">{h.full_name}</span>
                      <span className="block truncate text-[12px] text-[var(--text-muted)]">
                        {[h.class_name, h.payment_code ? `№ ${h.payment_code}` : null].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      {debt > 0 ? (
                        <Badge tone="danger">{money(debt)}</Badge>
                      ) : (
                        <Badge tone="ok">{t('quickpay.noDebt')}</Badge>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}

/**
 *  Qobiqqa bir marta qo'yiladi: oyna va F2 tugmasi. Telefonda oyna
 *  pastki paneldagi markaziy "+ To'lov" tugmasidan ochiladi.
 *  Faqat to'lov qabul qilish huquqi bor foydalanuvchiga ko'rinadi.
 */
export function QuickPayHost() {
  const { mayWrite } = useAuth();
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<QuickPayPreset | null>(null);
  const allowed = mayWrite('payments.create');

  useEffect(() => {
    if (!allowed) return;
    const off = onQuickPay((p) => {
      setPreset(p ?? null);
      setOpen(true);
    });
    const key = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        setPreset(null);
        setOpen(true);
      }
    };
    window.addEventListener('keydown', key);
    return () => {
      off();
      window.removeEventListener('keydown', key);
    };
  }, [allowed]);

  if (!allowed) return null;
  return open ? <QuickPay open preset={preset} onClose={() => setOpen(false)} /> : null;
}

/** Sahifa sarlavhasiga qo'yiladigan tugma. */
export function QuickPayButton() {
  const t = useT();
  const { mayWrite } = useAuth();
  if (!mayWrite('payments.create')) return null;
  return (
    //  Telefonda pastdagi suzuvchi tugma bor — sarlavhada takrorlanmaydi.
    <span className="hidden md:inline-flex">
      <Button onClick={() => openQuickPay()}>
        {t('quickpay.title')}
        <kbd className="ml-1 rounded border border-white/40 px-1 text-[10px]">F2</kbd>
      </Button>
    </span>
  );
}
