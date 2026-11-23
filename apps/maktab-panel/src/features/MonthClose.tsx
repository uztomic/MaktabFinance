// =====================================================================
//  Oylar — holat, ota-onaga eslatma, oyni yopish / qayta ochish.
//
//  "Hisoblanma" sahifasi olib tashlandi: hisoblanmani tizim o'zi
//  tuzadi, yangilaydi, oy tugagach yakunlab tasdiqlaydi
//  (run_monthly_invoices, har 10 daqiqa). Odamga faqat ikkita qaror
//  qoldi — ular shu yerda:
//    · ota-onalarga hisob/qarz xabarini yuborish;
//    · oyni yopish (keyin hech narsa o'zgarmaydi).
//  Yopilgan oyni FAQAT DIREKTOR, sabab yozib ochadi (unlock_period).
// =====================================================================

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n, useT } from '@/i18n';
import { currentPeriod, dateTime, money, periodLabel, shiftPeriod } from '@/lib/format';
import {
  Badge, Button, Card, Input, Loading, Modal, Notice,
} from '@/ui';

interface MonthRow {
  period: string;
  invoices: number;
  total: number;
  approved: boolean;
  closedAt: string | null;
  closedBy: string | null;
}

export function MonthClose() {
  const t = useT();
  const { lang } = useI18n();
  const qc = useQueryClient();
  const { branchId, branches, mayWrite, profile } = useAuth();
  const branch = branchId ?? null;
  const canClose = mayWrite('period.close');
  const canNotify = mayWrite('invoices.generate');
  const isOwner = profile?.role === 'director';

  const [locking, setLocking] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState<string | null>(null);

  const months = Array.from({ length: 12 }, (_, i) => shiftPeriod(currentPeriod(), -i));

  const q = useQuery({
    queryKey: ['month-close', branch],
    queryFn: async (): Promise<MonthRow[]> => {
      const [stat, closed] = await Promise.all([
        Promise.all(months.map((p) => supabase.rpc('report_invoice_status', {
          p_period: p, p_branch_id: branch ?? undefined,
        }))),
        supabase.from('closed_periods')
          .select('period, branch_id, closed_at, app_users(full_name)')
          .gte('period', months[months.length - 1]),
      ]);
      if (closed.error) throw closed.error;
      return months.map((p, i) => {
        const res = stat[i];
        if (res.error) throw res.error;
        const rows = res.data ?? [];
        const live = rows.filter((r) => r.status !== 'cancelled');
        const c = (closed.data ?? []).find((x) =>
          x.period === p && (x.branch_id === null || x.branch_id === branch));
        return {
          period: p,
          invoices: live.reduce((a, r) => a + Number(r.invoices ?? 0), 0),
          total: live.reduce((a, r) => a + Number(r.total ?? 0), 0),
          approved: live.length > 0 && live.every((r) => r.status === 'approved'),
          closedAt: c?.closed_at ?? null,
          // deno-lint-ignore no-explicit-any
          closedBy: (c as any)?.app_users?.full_name ?? null,
        };
      });
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['month-close'] });
    qc.invalidateQueries({ queryKey: ['closed-period'] });
  };

  const lock = useMutation({
    mutationFn: async (period: string) => {
      const { error } = await supabase.rpc('lock_period', {
        p_period: period, p_branch_id: branch ?? undefined,
        p_note: `${profile?.full_name ?? ''} tomonidan yopildi`,
      });
      if (error) throw error;
    },
    onSuccess: () => { setLocking(null); refresh(); },
  });

  const unlock = useMutation({
    mutationFn: async (period: string) => {
      const { error } = await supabase.rpc('unlock_period', {
        p_period: period, p_branch_id: branch ?? undefined, p_reason: reason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => { setOpening(null); setReason(''); refresh(); },
  });

  //  Filial tanlanmagan bo'lsa — hamma filialga.
  const notify = useMutation({
    mutationFn: async (period: string) => {
      const ids = branch ? [branch] : branches.map((b) => b.id);
      let sent = 0;
      for (const id of ids) {
        const { data, error } = await supabase.rpc('notify_invoices', {
          p_branch_id: id, p_period: period, p_final: false,
        });
        if (error) throw error;
        // deno-lint-ignore no-explicit-any
        sent += Number((data as any)?.queued ?? (data as any)?.sent ?? 0);
      }
      return sent;
    },
    onSuccess: (n) => setNote(t('mc.notified', { count: n })),
  });

  return (
    <>
      <Card padded={false} title={t('mc.title')}>
        {note && <div className="px-5 pt-3"><Notice tone="ok">{note}</Notice></div>}
        {notify.error && <div className="px-5 pt-3"><Notice tone="danger">{(notify.error as Error).message}</Notice></div>}
        {q.isLoading ? <Loading /> : q.error
          ? <div className="p-5"><Notice tone="danger">{(q.error as Error).message}</Notice></div>
          : (
            <div>
              {q.data!.map((m) => {
                const isCurrent = m.period === currentPeriod();
                return (
                  <div key={m.period}
                       className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--border-soft)] px-5 py-3 last:border-b-0">
                    <div className="w-36 shrink-0">
                      <div className="text-[14px] font-medium">{periodLabel(m.period, lang)}</div>
                      <div className="num text-[12px] text-[var(--text-faint)]">
                        {m.invoices > 0 ? money(m.total, lang) : '—'}
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      {m.closedAt
                        ? <Badge tone="neutral">🔒 {t('mc.closed')} · {dateTime(m.closedAt, lang)}{m.closedBy ? ` · ${m.closedBy}` : ''}</Badge>
                        : m.invoices === 0
                        ? <span className="text-[12.5px] text-[var(--text-faint)]">{t('mc.empty')}</span>
                        : m.approved
                        ? <Badge tone="ok">{t('mc.approved')}</Badge>
                        : <Badge tone="warn">{isCurrent ? t('mc.running') : t('mc.pending')}</Badge>}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-1.5">
                      {canNotify && !m.closedAt && m.invoices > 0 && (
                        <Button size="sm" variant="ghost" disabled={notify.isPending}
                                onClick={() => { setNote(null); notify.mutate(m.period); }}>
                          {t('mc.notify')}
                        </Button>
                      )}
                      {canClose && !m.closedAt && m.approved && (
                        <Button size="sm" onClick={() => setLocking(m.period)}>🔒 {t('mc.close')}</Button>
                      )}
                      {isOwner && m.closedAt && (
                        <Button size="sm" variant="ghost" onClick={() => { setReason(''); setOpening(m.period); }}>
                          {t('mc.reopen')}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
      </Card>

      <Modal
        open={!!locking}
        title={t('lock.title')}
        onClose={() => setLocking(null)}
        footer={<>
          <Button onClick={() => setLocking(null)}>{t('common.cancel')}</Button>
          <Button variant="danger" disabled={lock.isPending} onClick={() => locking && lock.mutate(locking)}>
            {lock.isPending ? t('common.saving') : t('lock.confirm', { period: locking ? periodLabel(locking, lang) : '' })}
          </Button>
        </>}
      >
        <div className="space-y-3">
          <Notice tone="warn">{t('mc.closeWarn')}</Notice>
          {lock.error && <Notice tone="danger">{(lock.error as Error).message}</Notice>}
        </div>
      </Modal>

      <Modal
        open={!!opening}
        title={`${t('mc.reopen')} — ${opening ? periodLabel(opening, lang) : ''}`}
        onClose={() => setOpening(null)}
        footer={<>
          <Button onClick={() => setOpening(null)}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={unlock.isPending || !reason.trim()}
                  onClick={() => opening && unlock.mutate(opening)}>
            {unlock.isPending ? t('common.saving') : t('mc.reopen')}
          </Button>
        </>}
      >
        <div className="space-y-3">
          <Notice tone="warn">{t('mc.reopenWarn')}</Notice>
          <Input value={reason} onChange={(e) => setReason(e.target.value)}
                 placeholder={t('mc.reasonPlaceholder')} autoFocus />
          {unlock.error && <Notice tone="danger">{(unlock.error as Error).message}</Notice>}
        </div>
      </Modal>
    </>
  );
}
