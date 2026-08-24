// =====================================================================
//  Tizim jurnali (TZ 5.4.10).
//
//  "Har bir moliyaviy o'zgarish audit jurnalida qayd etiladi: kim,
//   qachon, qaysi qiymatdan qaysi qiymatga."
//
//  TZ 4.13.5.2 — texnik yordam rejimida bajarilgan amallar shu yerda
//  ALOHIDA belgilanadi va DIREKTORGA KO'RINADI. Ya'ni platforma
//  operatorining ishi mijozdan yashirilmaydi.
//
//  Jurnal FAQAT O'QISH uchun: bazada UPDATE/DELETE siyosati umuman
//  yaratilmagan, shuning uchun uni hech kim tahrirlay olmaydi.
// =====================================================================

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n, useT } from '@/i18n';
import { dateTime } from '@/lib/format';
import {
  Badge, Button, Card, EmptyState, ErrorState, Loading, Notice,
  PageHeader, Select, Table, Td, Th, Tr,
} from '@/ui';

const ACTION_TONE: Record<string, 'ok' | 'warn' | 'danger'> = {
  INSERT: 'ok',
  UPDATE: 'warn',
  DELETE: 'danger',
};

/**
 * Jurnalda uchraydigan jadvallar — filtr ro'yxati uchun.
 * Ko'rinadigan nomi `audit.table.<jadval>` kalitidan olinadi, shunda
 * ruscha interfeysda ham to'g'ri chiqadi.
 */
const AUDIT_TABLES = [
  'students', 'contracts', 'invoices', 'invoice_lines', 'payments',
  'payment_proofs', 'cash_receipts', 'student_services', 'student_parents',
  'expenses', 'payroll_runs', 'payroll_lines', 'services', 'service_prices',
  'absences', 'attendance_checks', 'app_users', 'branches', 'classes',
  'teachers', 'lessons', 'closed_periods', 'payroll_settings',
  'school_settings', 'parents',
] as const;

export default function Audit() {
  const t = useT();
  const { lang } = useI18n();
  const { can } = useAuth();

  const [table, setTable] = useState('');
  const [limit, setLimit] = useState(100);

  const rows = useQuery({
    queryKey: ['audit', table, limit],
    queryFn: async () => {
      let q = supabase
        .from('audit_log')
        .select('id, at, table_name, record_id, action, changed_keys, before, after, user_id, impersonated_by')
        .order('at', { ascending: false })
        .limit(limit);
      if (table) q = q.eq('table_name', table);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  // Foydalanuvchi ismlarini alohida olamiz (audit_log da FK yo'q —
  // xodim o'chirilsa ham jurnal saqlanib qolishi kerak).
  const users = useQuery({
    queryKey: ['audit-users'],
    queryFn: async () => {
      const { data } = await supabase.from('app_users').select('id, full_name');
      return new Map((data ?? []).map((u) => [u.id, u.full_name]));
    },
  });

  if (!can('reports.view')) {
    return <Notice tone="danger">{t('common.noAccess')}</Notice>;
  }
  if (rows.isLoading) return <Loading />;
  if (rows.error) {
    return <ErrorState message={(rows.error as Error).message}
                       onRetry={() => rows.refetch()} />;
  }

  const impersonated = (rows.data ?? []).filter((r) => r.impersonated_by).length;

  return (
    <>
      <PageHeader title={t('audit.title')} subtitle={t('audit.hint')} />

      {impersonated > 0 && (
        <div className="mb-3">
          <Notice tone="warn">
            <strong>{t('audit.impersonated')}: {impersonated}</strong>
            {' — '}{t('audit.impersonatedHint')}
          </Notice>
        </div>
      )}

      <div className="mb-3 flex flex-wrap gap-2">
        <Select value={table} onChange={(e) => setTable(e.target.value)}
                className="w-auto min-w-[12rem]">
          <option value="">{t('common.all')}</option>
          {AUDIT_TABLES.map((k) => (
            <option key={k} value={k}>{t(`audit.table.${k}`)}</option>
          ))}
        </Select>
        <Button size="sm" onClick={() => rows.refetch()}>
          {t('common.refresh')}
        </Button>
      </div>

      <Card padded={false}>
        {(rows.data?.length ?? 0) === 0 ? <EmptyState /> : (
          <Table>
            <thead>
              <tr>
                <Th>{t('common.date')}</Th>
                <Th>{t('audit.table')}</Th>
                <Th>{t('audit.action')}</Th>
                <Th>{t('audit.user')}</Th>
                <Th>{t('audit.changed')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.data!.map((r) => (
                <Tr key={r.id}>
                  <Td mono className="whitespace-nowrap text-[var(--text-muted)]">
                    {dateTime(r.at, lang)}
                  </Td>
                  <Td>{t(`audit.table.${r.table_name}`)}</Td>
                  <Td>
                    <Badge tone={ACTION_TONE[r.action] ?? 'neutral'}>
                      {t(`audit.action.${r.action}`)}
                    </Badge>
                  </Td>
                  <Td>
                    <span className="text-[13px]">
                      {r.user_id ? users.data?.get(r.user_id) ?? '—' : 'tizim'}
                    </span>
                    {r.impersonated_by && (
                      <span className="ml-1.5">
                        <Badge tone="warn">{t('audit.impersonated')}</Badge>
                      </span>
                    )}
                  </Td>
                  <Td className="max-w-md">
                    <ChangeSummary
                      keys={r.changed_keys}
                      before={r.before as Record<string, unknown> | null}
                      after={r.after as Record<string, unknown> | null}
                    />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {(rows.data?.length ?? 0) >= limit && (
        <div className="mt-3 text-center">
          <Button onClick={() => setLimit((l) => l + 200)}>
            {t('common.next')}
          </Button>
        </div>
      )}
    </>
  );
}

/** Qaysi maydon qaysi qiymatdan qaysi qiymatga o'zgargani (TZ 5.4.10). */
function ChangeSummary({
  keys, before, after,
}: {
  keys: string[] | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}) {
  const HIDE = new Set(['id', 'school_id', 'created_at', 'updated_at']);

  if (!keys?.length) {
    // INSERT yoki DELETE — asosiy maydonlarni ko'rsatamiz.
    const src = after ?? before ?? {};
    const shown = Object.entries(src)
      .filter(([k, v]) =>
        !HIDE.has(k) && v !== null && v !== '' && typeof v !== 'object')
      .slice(0, 4);
    return (
      <span className="text-[12px] text-[var(--text-muted)]">
        {shown.map(([k, v]) => `${k}: ${String(v)}`).join(' · ') || '—'}
      </span>
    );
  }

  const visible = keys.filter((k) => !HIDE.has(k)).slice(0, 4);

  return (
    <div className="space-y-0.5">
      {visible.map((k) => (
        <div key={k} className="text-[12px]">
          <span className="text-[var(--text-muted)]">{k}: </span>
          <span className="text-[var(--danger)] line-through">
            {fmt(before?.[k])}
          </span>
          <span className="mx-1 text-[var(--text-faint)]">→</span>
          <span className="text-[var(--ok)]">{fmt(after?.[k])}</span>
        </div>
      ))}
      {keys.filter((k) => !HIDE.has(k)).length > 4 && (
        <div className="text-[11px] text-[var(--text-faint)]">
          +{keys.filter((k) => !HIDE.has(k)).length - 4}
        </div>
      )}
    </div>
  );
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 40);
  return String(v).slice(0, 40);
}
