// =====================================================================
//  "Mening yuklamam" — o'qituvchi PWA si (TZ 3.1, 5.2).
//
//  O'qituvchi FAQAT O'ZINING ma'lumotini ko'radi. Bu brauzerdagi
//  filtr bilan emas, BAZADAGI RLS siyosati bilan ta'minlangan:
//  `lessons_select_own` faqat teachers.user_id = auth.uid() bo'lgan
//  qatorlarni ochadi. Ya'ni so'rovni o'zgartirib ham boshqa
//  o'qituvchining darslarini ko'rib bo'lmaydi.
//
//  Mobil-birinchi: yirik matn, kartochkalar, jadval emas.
// =====================================================================

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useI18n, useT } from '@/i18n';
import { currentPeriod, date, isoDate, num, periodLabel, shiftPeriod } from '@/lib/format';
import { Badge, Button, Card, EmptyState, ErrorState, Loading, PageHeader } from '@/ui';

const TONE = {
  held: 'ok',
  substituted: 'brand',
  not_held: 'danger',
} as const;

export default function MyLoad() {
  const t = useT();
  const { lang } = useI18n();
  const [period, setPeriod] = useState(currentPeriod());

  const d = new Date(period);
  const to = isoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));

  const lessons = useQuery({
    queryKey: ['my-lessons', period],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lessons')
        .select('id, day, hours, kind, subject, class_name, reason, branches(name)')
        .gte('day', period)
        .lte('day', to)
        .order('day', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  if (lessons.isLoading) return <Loading />;
  if (lessons.error) {
    return (
      <ErrorState
        message={(lessons.error as Error).message}
        onRetry={() => lessons.refetch()}
      />
    );
  }

  const rows = lessons.data ?? [];
  const totals = rows.reduce((acc, l) => {
    const h = Number(l.hours);
    if (l.kind === 'held') acc.held += h;
    else if (l.kind === 'substituted') acc.subst += h;
    else acc.unheld += h;
    return acc;
  }, { held: 0, subst: 0, unheld: 0 });

  return (
    <>
      <PageHeader
        title={t('nav.myLoad')}
        subtitle={periodLabel(period, lang)}
        actions={
          <>
            <Button size="sm" onClick={() => setPeriod(shiftPeriod(period, -1))}>←</Button>
            <Button size="sm" onClick={() => setPeriod(shiftPeriod(period, 1))}>→</Button>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-3 gap-2">
        <Stat label={t('lessons.kind.held')} value={num(totals.held, lang, 1)} tone="ok" />
        <Stat label={t('lessons.kind.substituted')} value={num(totals.subst, lang, 1)} />
        <Stat
          label={t('lessons.kind.not_held')}
          value={num(totals.unheld, lang, 1)}
          tone="danger"
        />
      </div>

      <Card title={t('lessons.title')} padded={false}>
        {rows.length === 0 ? <EmptyState /> : (
          <ul className="divide-y divide-[var(--border-soft)]">
            {rows.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">
                    {l.subject ?? t('lessons.title')}
                    {l.class_name && (
                      <span className="ml-1.5 text-[var(--text-muted)]">
                        {l.class_name}
                      </span>
                    )}
                  </div>
                  <div className="num text-[12px] text-[var(--text-muted)]">
                    {date(l.day, lang)}
                    {l.reason ? ` · ${l.reason}` : ''}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="num text-sm font-semibold">
                    {num(l.hours, lang, 1)}
                  </span>
                  <Badge tone={TONE[l.kind as keyof typeof TONE] ?? 'neutral'}>
                    {t(`lessons.kind.${l.kind}`)}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function Stat({
  label, value, tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'ok' | 'danger';
}) {
  const color = tone === 'ok'
    ? 'text-[var(--ok)]'
    : tone === 'danger'
    ? 'text-[var(--danger)]'
    : '';
  return (
    <div className="rounded-lg border bg-[var(--bg)] px-3 py-2.5 text-center">
      <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
        {label}
      </div>
      <div className={`num mt-0.5 text-lg font-semibold ${color}`}>{value}</div>
    </div>
  );
}
