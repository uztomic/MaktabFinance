// =====================================================================
//  Batafsil qaydnoma (TZ 4.11.7).
//
//  "Har bir o'qituvchi uchun batafsil qaydnoma shakllantiriladi —
//   HAR BIR QATOR QAYERDAN KELGANI ko'rinadi."
//
//  Shuning uchun har bir qatorning `source` maydoni ochib beriladi:
//  qaysi formula, qaysi parametr, qanday baza ishlatilgan. Buxgalter
//  "bu 750 000 qayerdan chiqdi?" degan savolga bir qarashda javob
//  topadi — bu nizoli holatlarni oldini oladi (TZ 1.2).
// =====================================================================

import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useI18n, useT } from '@/i18n';
import { date, money, num, periodLabel } from '@/lib/format';
import {
  Badge, Button, Card, EmptyState, ErrorState, Loading, PageHeader,
} from '@/ui';

/** `source` jsonb ni o'qish oson matnga aylantiradi. */
function explain(
  source: Record<string, unknown> | null,
  lang: 'uz' | 'uz-cyrl' | 'ru',
): string[] {
  if (!source) return [];
  const out: string[] = [];

  const LABEL: Record<string, string> = {
    formula: 'Formula',
    base_salary: 'Qat\'iy oylik',
    rate_factor: 'Stavka ulushi',
    hours_per_rate: 'Norma soat',
    hour_price: 'Soat narxi',
    category_factor: 'Toifa koeffitsiyenti',
    held_hours: 'O\'tilgan soat',
    subst_hours: 'O\'rniga kirilgan soat',
    substitution_percent: 'O\'rniga kirish foizi',
    paid_percent: 'To\'lanadigan foiz',
    reason: 'Sabab',
    hours: 'Soat',
    code: 'Kod',
    type: 'Turi',
    value: 'Qiymat',
    base: 'Baza',
    overridden: 'Shaxsiy qiymat',
    paid_on: 'To\'langan sana',
    before: 'Yaxlitlashdan oldin',
    after: 'Yaxlitlashdan keyin',
    step: 'Yaxlitlash qadami',
    mode: 'Yaxlitlash yo\'nalishi',
    from: 'dan',
    to: 'gacha',
  };

  const MONEY_KEYS = new Set([
    'base_salary', 'hour_price', 'base', 'before', 'after', 'value',
  ]);

  for (const [k, v] of Object.entries(source)) {
    if (v === null || v === undefined || v === '') continue;
    if (k === 'advance_id') continue;

    const label = LABEL[k] ?? k;
    let text: string;

    if (typeof v === 'boolean') text = v ? 'ha' : 'yo\'q';
    else if (MONEY_KEYS.has(k) && typeof v === 'number') text = money(v, lang);
    else if (typeof v === 'number') text = num(v, lang, 2);
    else text = String(v);

    out.push(`${label}: ${text}`);
  }
  return out;
}

export default function PayrollCard() {
  const { id } = useParams<{ id: string }>();
  const t = useT();
  const { lang } = useI18n();

  const run = useQuery({
    queryKey: ['payroll-run', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payroll_runs')
        .select('*, teachers(full_name, category, rate_factor)')
        .eq('id', id!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const lines = useQuery({
    queryKey: ['payroll-lines', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payroll_lines')
        .select('*, branches(name)')
        .eq('payroll_run_id', id!)
        .order('sort_order');
      if (error) throw error;
      return data ?? [];
    },
  });

  if (run.isLoading) return <Loading />;
  if (run.error) return <ErrorState message={(run.error as Error).message} />;
  if (!run.data) return <EmptyState />;

  const r = run.data;
  // deno-lint-ignore no-explicit-any
  const teacher = (r as any).teachers;
  const rows = lines.data ?? [];

  const gross = rows.filter((l) => Number(l.amount) > 0)
    .reduce((s, l) => s + Number(l.amount), 0);
  const deductions = rows.filter((l) => Number(l.amount) < 0)
    .reduce((s, l) => s + Number(l.amount), 0);
  const net = gross + deductions;

  return (
    <>
      <div className="no-print mb-2">
        <Link to="/oylik" className="text-[13px] text-[var(--text-muted)] hover:underline">
          ← {t('payroll.title')}
        </Link>
      </div>

      <PageHeader
        title={teacher?.full_name ?? ''}
        subtitle={[
          periodLabel(String(r.period), lang),
          `${date(r.period_from, lang)} — ${date(r.period_to, lang)}`,
          teacher?.category,
        ].filter(Boolean).join(' · ')}
        actions={
          <>
            <Badge tone={r.status === 'approved' ? 'ok' : 'warn'}>
              {r.status === 'approved' ? t('payroll.approved') : t('payroll.draft')}
            </Badge>
            <Button className="no-print" onClick={() => window.print()}>
              {t('common.print')}
            </Button>
          </>
        }
      />

      <Card title={t('payroll.sheet')} padded={false}>
        {rows.length === 0 ? <EmptyState /> : (
          <div className="divide-y divide-[var(--border-soft)]">
            {rows.map((l) => {
              const amount = Number(l.amount);
              const negative = amount < 0;
              const details = explain(
                l.source as Record<string, unknown> | null, lang);

              return (
                <div key={l.id} className="px-4 py-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="min-w-0">
                      <span className="text-sm font-medium">{l.description}</span>
                      {/* deno-lint-ignore no-explicit-any */}
                      {(l as any).branches?.name && (
                        <span className="ml-2 text-[11px] text-[var(--text-faint)]">
                          {/* deno-lint-ignore no-explicit-any */}
                          {(l as any).branches.name}
                        </span>
                      )}
                      {Number(l.quantity) !== 1 && (
                        <span className="num ml-2 text-[12px] text-[var(--text-muted)]">
                          {num(l.quantity, lang, 2)} × {money(l.unit_price, lang)}
                        </span>
                      )}
                    </div>
                    <span className={`num shrink-0 text-sm font-semibold
                      ${negative ? 'text-[var(--danger)]' : ''}`}>
                      {negative ? '−' : ''}{money(Math.abs(amount), lang)}
                    </span>
                  </div>

                  {/* TZ 4.11.7 — qator qayerdan kelgani */}
                  {details.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                      {details.map((d, i) => (
                        <span key={i} className="text-[11px] text-[var(--text-faint)]">
                          {d}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            <div className="bg-[var(--bg-subtle)] px-4 py-3">
              <div className="flex justify-between text-[13px]">
                <span className="text-[var(--text-muted)]">{t('payroll.gross')}</span>
                <span className="num font-medium">{money(gross, lang)}</span>
              </div>
              {deductions < 0 && (
                <div className="mt-1 flex justify-between text-[13px]">
                  <span className="text-[var(--text-muted)]">
                    {t('payroll.deductions')}
                  </span>
                  <span className="num font-medium text-[var(--danger)]">
                    −{money(-deductions, lang)}
                  </span>
                </div>
              )}
              <div className="mt-2 flex justify-between border-t pt-2 text-sm">
                <span className="font-semibold">{t('payroll.net')}</span>
                <span className="num text-base font-semibold">{money(net, lang)}</span>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Hisoblashda ishlatilgan parametrlar nusxasi — nizoli holatda
          "o'sha paytda qanday hisoblangani" isbotlanadi. */}
      {r.settings_snapshot && (
        <Card title={t('payroll.settings')} className="mt-4">
          <pre className="overflow-x-auto rounded bg-[var(--bg-inset)] p-3
            text-[11px] leading-relaxed text-[var(--text-muted)]">
            {JSON.stringify(r.settings_snapshot, null, 2)}
          </pre>
        </Card>
      )}
    </>
  );
}
