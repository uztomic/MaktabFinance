// =====================================================================
//  Xabarlar jurnali (TZ 4.9.4).
//
//  "Yuborilgan barcha xabarlar jurnalda saqlanadi, YETKAZILMAGANLARI
//   KO'RINADI."
//
//  Direktor uchun muhim: ota-ona "menga xabar kelmadi" desa, bu yerda
//  xabar yuborilganmi, qachon va nima uchun yetmaganini ko'rish mumkin.
//
//  `blocked` holati — foydalanuvchi botni bloklagan yoki chat topilmadi.
//  Bunda takror urinilmaydi (TZ 4.9.1.5), lekin direktor buni ko'radi
//  va ota-ona bilan boshqa yo'l bilan bog'lanadi.
// =====================================================================

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n, useT } from '@/i18n';
import { dateTime } from '@/lib/format';
import { exportTable } from '@/lib/export';
import {
  Badge, Button, Card, EmptyState, ErrorState, Loading, Notice,
  PageHeader, Select, Table, Td, Th, Tr,
} from '@/ui';

type Status = 'pending' | 'sent' | 'failed' | 'blocked';

const TONE: Record<Status, 'warn' | 'ok' | 'danger' | 'neutral'> = {
  pending: 'warn',
  sent: 'ok',
  failed: 'danger',
  blocked: 'neutral',
};

/** Xabar turi kalitini o'qish oson nomga aylantiradi. */
const TEMPLATE_LABEL: Record<string, string> = {
  invoice_created: 'Hisoblanma shakllandi',
  invoice_final: 'Yakuniy hisoblanma',
  due_soon: 'Muddat yaqinlashdi',
  overdue: "Muddat o'tdi",
  payment_received: "To'lov qabul qilindi",
  proof_confirmed: 'Chek tasdiqlandi',
  proof_rejected: 'Chek rad etildi',
};

export default function Messages() {
  const t = useT();
  const { lang } = useI18n();
  const qc = useQueryClient();
  const { can, mayWrite } = useAuth();

  const [status, setStatus] = useState<Status | ''>('');

  const rows = useQuery({
    queryKey: ['messages', status],
    queryFn: async () => {
      let q = supabase
        .from('message_queue')
        .select('id, template_key, lang, status, attempts, last_error, scheduled_at, sent_at, created_at, chat_id, student_id, parent_id, students(full_name), parents(full_name, phone)')
        .order('created_at', { ascending: false })
        .limit(300);
      if (status) q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  // Xato bo'lgan xabarni qayta navbatga qo'yish.
  const retry = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase
        .from('message_queue')
        .update({
          status: 'pending',
          attempts: 0,
          last_error: null,
          scheduled_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['messages'] }),
  });

  const counts = useMemo(() => {
    const c: Record<string, number> = {
      pending: 0, sent: 0, failed: 0, blocked: 0,
    };
    for (const m of rows.data ?? []) c[m.status] = (c[m.status] ?? 0) + 1;
    return c;
  }, [rows.data]);

  if (!can('reports.view')) {
    return <Notice tone="danger">{t('common.noAccess')}</Notice>;
  }
  if (rows.isLoading) return <Loading />;
  if (rows.error) {
    return <ErrorState message={(rows.error as Error).message}
                       onRetry={() => rows.refetch()} />;
  }

  const list = rows.data ?? [];
  const undelivered = counts.failed + counts.blocked;

  return (
    <>
      <PageHeader
        title={t('msg.title')}
        subtitle={t('msg.hint')}
        actions={
          <Button
            disabled={list.length === 0}
            onClick={() => exportTable(
              'xabarlar',
              [
                { header: t('common.date'), value: (m) => m.created_at },
                { header: t('msg.template'), value: (m) => TEMPLATE_LABEL[m.template_key] ?? m.template_key },
                // deno-lint-ignore no-explicit-any
                { header: t('msg.recipient'), value: (m) => (m as any).parents?.full_name },
                // deno-lint-ignore no-explicit-any
                { header: t('students.title'), value: (m) => (m as any).students?.full_name },
                { header: t('common.status'), value: (m) => t(`msg.status.${m.status}`) },
                { header: t('msg.attempts'), value: (m) => m.attempts, numeric: true },
                { header: t('msg.error'), value: (m) => m.last_error },
              ],
              list,
              [t('msg.title')],
            )}
          >
            {t('common.export')}
          </Button>
        }
      />

      {undelivered > 0 && (
        <div className="mb-3">
          <Notice tone="warn">
            <strong>{undelivered}</strong> ta xabar yetkazilmadi.
            {counts.blocked > 0 && <> {t('msg.blockedHint')}</>}
          </Notice>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select value={status} onChange={(e) => setStatus(e.target.value as Status | '')}
                className="w-auto min-w-[10rem]">
          <option value="">{t('common.all')}</option>
          {(['pending', 'sent', 'failed', 'blocked'] as Status[]).map((s) => (
            <option key={s} value={s}>
              {t(`msg.status.${s}`)} ({counts[s] ?? 0})
            </option>
          ))}
        </Select>
        <Button size="sm" onClick={() => rows.refetch()}>{t('common.refresh')}</Button>
      </div>

      <Card padded={false}>
        {list.length === 0 ? <EmptyState /> : (
          <Table>
            <thead>
              <tr>
                <Th>{t('common.date')}</Th>
                <Th>{t('msg.template')}</Th>
                <Th>{t('msg.recipient')}</Th>
                <Th>{t('common.status')}</Th>
                <Th align="right">{t('msg.attempts')}</Th>
                <Th>{t('msg.error')}</Th>
                <Th align="right">{t('common.actions')}</Th>
              </tr>
            </thead>
            <tbody>
              {list.map((m) => {
                // deno-lint-ignore no-explicit-any
                const parent = (m as any).parents;
                // deno-lint-ignore no-explicit-any
                const student = (m as any).students;
                return (
                  <Tr key={m.id}>
                    <Td mono className="whitespace-nowrap text-[var(--text-muted)]">
                      {dateTime(m.sent_at ?? m.created_at, lang)}
                    </Td>
                    <Td>{TEMPLATE_LABEL[m.template_key] ?? m.template_key}</Td>
                    <Td>
                      <div className="text-[13px]">{parent?.full_name ?? '—'}</div>
                      {student?.full_name && (
                        <Link to={`/oquvchilar/${m.student_id}`}
                              className="text-[11px] text-[var(--text-faint)]
                                hover:underline">
                          {student.full_name}
                        </Link>
                      )}
                    </Td>
                    <Td>
                      <Badge tone={TONE[m.status as Status]}>
                        {t(`msg.status.${m.status}`)}
                      </Badge>
                    </Td>
                    <Td align="right" mono className="text-[var(--text-muted)]">
                      {m.attempts}
                    </Td>
                    <Td className="max-w-xs truncate text-[12px]
                      text-[var(--text-muted)]">
                      {m.last_error ?? '—'}
                    </Td>
                    <Td align="right">
                      {(m.status === 'failed' || m.status === 'blocked') &&
                        mayWrite('reports.view') && (
                        <Button size="sm" variant="ghost"
                                title={t('msg.retryHint')}
                                onClick={() => retry.mutate(m.id)}>
                          {t('msg.retry')}
                        </Button>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
