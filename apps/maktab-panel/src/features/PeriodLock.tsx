// =====================================================================
//  Oyni yopish (TZ 5.4.9, TZ 3.1 — direktor amali).
//
//  "Yopilgan davr qulflanadi. Qulflangan davr yozuvlari tahrirlanmaydi,
//   tuzatish faqat joriy davrda tuzatuvchi yozuv orqali."
//
//  Bazada `guard_closed_period` triggeri buni majburiy qiladi:
//  yopilgan davrga hisoblanma, to'lov, xarajat, yo'qlik yoki oylik
//  yozib bo'lmaydi. Bu ekran shu amalni direktorga ochadi.
// =====================================================================

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n, useT } from '@/i18n';
import { dateTime, periodLabel } from '@/lib/format';
import { Badge, Button, Modal, Notice } from '@/ui';

export function PeriodLockButton({
  period, branchId, allApproved,
}: {
  period: string;
  branchId: string | null;
  /** Hisoblanmalar tasdiqlanganmi — yopishdan oldin shu talab qilinadi. */
  allApproved: boolean;
}) {
  const t = useT();
  const { lang } = useI18n();
  const qc = useQueryClient();
  const { mayWrite, profile } = useAuth();

  const [open, setOpen] = useState(false);

  const closed = useQuery({
    queryKey: ['closed-period', period, branchId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('closed_periods')
        .select('id, period, branch_id, closed_at, closed_by, note, app_users(full_name)')
        .eq('period', period);
      if (error) throw error;
      // Maktab bo'yicha (branch_id null) yoki shu filial bo'yicha.
      return (data ?? []).find((c) =>
        c.branch_id === null || c.branch_id === branchId) ?? null;
    },
  });

  const lock = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('lock_period', {
        p_period: period,
        p_branch_id: branchId ?? undefined,
        p_note: `${profile?.full_name ?? ''} tomonidan yopildi`,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['closed-period'] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
      setOpen(false);
    },
  });

  const isClosed = !!closed.data;
  const canLock = mayWrite('period.close');

  // Yopilgan bo'lsa faqat holatni ko'rsatamiz.
  if (isClosed) {
    // deno-lint-ignore no-explicit-any
    const by = (closed.data as any)?.app_users?.full_name;
    return (
      <div className="flex items-center gap-2 rounded-lg border
        border-[var(--ok)] bg-[var(--ok-bg)] px-3 py-2">
        <Badge tone="ok">🔒 {t('lock.locked')}</Badge>
        <span className="text-[12px] text-[var(--text-muted)]">
          {dateTime(closed.data!.closed_at, lang)}
          {by && ` · ${by}`}
        </span>
      </div>
    );
  }

  if (!canLock) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!allApproved}
        className="flex-1 min-w-[13rem] rounded-lg border p-3 text-left
          transition-colors hover:bg-[var(--bg-subtle)]
          disabled:cursor-not-allowed disabled:opacity-45"
      >
        <div className="flex items-center gap-2">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center
            rounded-full bg-[var(--bg-inset)] text-[11px] font-semibold
            text-[var(--text-muted)]">
            5
          </span>
          <span className="text-sm font-medium">🔒 {t('lock.action')}</span>
        </div>
        <p className="mt-1 pl-7 text-[11px] leading-snug text-[var(--text-muted)]">
          {allApproved ? t('lock.hint') : t('lock.notApproved')}
        </p>
      </button>

      <Modal
        open={open}
        title={t('lock.title')}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button variant="danger" disabled={lock.isPending}
                    onClick={() => lock.mutate()}>
              {lock.isPending
                ? t('common.saving')
                : t('lock.confirm', { period: periodLabel(period, lang) })}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm font-medium">{periodLabel(period, lang)}</p>
          <Notice tone="warn">{t('lock.hint')}</Notice>
          <Notice tone="danger">{t('lock.warning')}</Notice>
          {lock.error && (
            <Notice tone="danger">{(lock.error as Error).message}</Notice>
          )}
        </div>
      </Modal>
    </>
  );
}
