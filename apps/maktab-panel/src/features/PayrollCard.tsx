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

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useI18n, useT } from '@/i18n';
import { date, money, num, periodLabel } from '@/lib/format';
import { payrollLabel, valueLabel } from '@/lib/fieldNames';
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Input, Loading,
  Modal, MoneyInput, Notice, PageHeader,
} from '@/ui';
import { useToast } from '@/ui/Feedback';
import { useAuth } from '@/auth/AuthProvider';

/**
 *  `source` jsonb ni o'qish oson matnga aylantiradi.
 *
 *  NIMA CHIQARILMAYDI va NEGA:
 *
 *    · `formula` — "base_salary * rate_factor" degan XOM KOD edi va
 *      ekranda shundayligicha turardi. Buxgalterga u hech narsa
 *      aytmaydi, chunki formulada qatnashgan raqamlarning o'zi
 *      quyida yonma-yon yozib qo'yilgan.
 *    · `code` — ustama yoki ushlanma kodi ("class_teacher"). Uning
 *      NOMI allaqachon qatorning sarlavhasida turibdi.
 *    · `overridden: yo'q` — yolg'on qiymat hech narsa bildirmaydi,
 *      faqat shovqin. Faqat ROST bo'lsa ko'rsatiladi.
 */
function explain(
  source: Record<string, unknown> | null,
  lang: 'uz' | 'uz-cyrl' | 'ru',
  t: (key: string) => string,
): string[] {
  if (!source) return [];
  const out: string[] = [];

  //  `type` ham yashiriladi: qiymatning O'ZI foizmi yoki summami
  //  ekanini ko'rsatib turadi ("15%" yoki "250 000"), ya'ni
  //  "Turi: Foiz" degan alohida qator faqat takror.
  const HIDE = new Set(['formula', 'code', 'type', 'advance_id']);
  const MONEY_KEYS = new Set([
    'base_salary', 'hour_price', 'base', 'before', 'after', 'step',
  ]);

  for (const [k, v] of Object.entries(source)) {
    if (v === null || v === undefined || v === '') continue;
    if (HIDE.has(k)) continue;
    if (k === 'overridden' && v !== true) continue;

    const label = payrollLabel(t, k);
    let text: string;

    //  Qiymatning O'ZI kod bo'lishi mumkin: "percent", "nearest",
    //  "teacher_absent". Ular ham tarjima qilinadi.
    const translated = valueLabel(t, k, v);

    if (translated) text = translated;
    else if (typeof v === 'boolean') text = v ? t('common.yes') : t('common.no');
    else if (MONEY_KEYS.has(k) && typeof v === 'number') text = money(v, lang);
    else if (k === 'value' && typeof v === 'number') {
      //  Ustama/ushlanma qiymati: foiz bo'lsa "15%", qat'iy bo'lsa summa.
      text = source.type === 'percent' ? `${num(v, lang, 2)}%` : money(v, lang);
    } else if (typeof v === 'number') text = num(v, lang, 2);
    else if (k === 'paid_on' || k === 'from' || k === 'to') {
      text = date(String(v), lang);
    } else text = String(v);

    out.push(`${label}: ${text}`);
  }
  return out;
}

/**
 *  Hisoblashda ishlatilgan sozlamalar.
 *
 *  Ilgari bu `JSON.stringify(...)` bilan xom holda to'kib qo'yilgan
 *  edi — ekranda "base_type": "fixed", "unheld_lesson_policy": {...}
 *  degan yarim sahifa kod turardi. Direktor uchun bu o'qib bo'lmaydigan
 *  narsa, holbuki aynan shu yozuv nizoli holatda dalil bo'lishi kerak.
 *
 *  Endi o'qiladigan ro'yxat chiqadi. Xom JSON YO'QOTILMAYDI —
 *  yig'ilgan bo'limda qoladi, chunki texnik xodimga u kerak bo'lishi
 *  mumkin.
 */
function SettingsSnapshot({ data, lang, t }: {
  data: Record<string, unknown>;
  lang: 'uz' | 'uz-cyrl' | 'ru';
  t: (key: string) => string;
}) {
  const rows: Array<[string, string]> = [];
  const push = (label: string, value: string | null) => {
    if (value) rows.push([label, value]);
  };

  const period = data.period as { from?: string; to?: string } | undefined;
  if (period?.from && period?.to) {
    push(t('payroll.period'),
      `${date(period.from, lang)} — ${date(period.to, lang)}`);
  }

  push(t('pf.base.title'),
    valueLabel(t, 'base_type', data.base_type) ?? String(data.base_type ?? ''));

  if (data.category) {
    const f = Number(data.category_factor ?? 1);
    push(t('teachers.category'),
      f === 1 ? String(data.category)
        : `${data.category} · ${num(f, lang, 2)}`);
  }

  if (Number(data.base_salary) > 0) {
    push(t('pl.base_salary'), money(Number(data.base_salary), lang));
  }
  if (data.rate_factor !== undefined) {
    push(t('pl.rate_factor'), num(Number(data.rate_factor), lang, 2));
  }
  if (Number(data.hour_price) > 0) {
    push(t('pf.hourPrice'), money(Number(data.hour_price), lang));
  }
  if (Number(data.hours_per_rate) > 0) {
    push(t('pf.hoursPerRate'), num(Number(data.hours_per_rate), lang, 2));
  }
  if (data.substitution_percent !== undefined) {
    push(t('pf.substitution'), `${num(Number(data.substitution_percent), lang, 2)}%`);
  }

  const rounding = data.rounding as { step?: number; mode?: string } | undefined;
  if (rounding?.step) {
    push(t('payroll.rounding'),
      [money(rounding.step, lang),
        valueLabel(t, 'mode', rounding.mode)].filter(Boolean).join(' · '));
  }

  //  Ustama va ushlanma — nomi va miqdori bilan, kodsiz.
  const named = (list: unknown): string | null => {
    if (!Array.isArray(list) || list.length === 0) return null;
    return list.map((x) => {
      const row = x as { name?: string; type?: string; value?: number };
      const v = row.type === 'percent'
        ? `${num(Number(row.value), lang, 2)}%`
        : money(Number(row.value), lang);
      return `${row.name} — ${v}`;
    }).join(' · ');
  };

  push(t('pf.allowances'), named(data.allowances));
  push(t('pf.deductions'), named(data.deductions));

  //  O'tkazilmagan dars qoidasi: sabab kodlari tarjima qilinadi.
  const policy = data.unheld_lesson_policy as
    Record<string, { paid_percent?: number }> | undefined;
  if (policy && Object.keys(policy).length > 0) {
    push(t('pf.unheld'),
      Object.entries(policy)
        .map(([reason, cfg]) =>
          `${valueLabel(t, 'reason', reason) ?? reason} — ${cfg?.paid_percent ?? 0}%`)
        .join(' · '));
  }

  return (
    <>
      <dl className="space-y-1.5 text-[13px]">
        {rows.map(([label, value]) => (
          <div key={label} className="flex flex-wrap items-baseline justify-between gap-2">
            <dt className="text-[var(--text-muted)]">{label}</dt>
            <dd className="text-right">{value}</dd>
          </div>
        ))}
      </dl>

      <details className="mt-3">
        <summary className="cursor-pointer text-[12px] text-[var(--text-faint)]
          hover:text-[var(--text-muted)]">
          {t('pf.advanced')}
        </summary>
        <pre className="mt-2 overflow-x-auto rounded bg-[var(--bg-inset)] p-3
          text-[11px] leading-relaxed text-[var(--text-muted)]">
          {JSON.stringify(data, null, 2)}
        </pre>
      </details>
    </>
  );
}

export default function PayrollCard() {
  const { id } = useParams<{ id: string }>();
  const t = useT();
  const { lang } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const { mayWrite } = useAuth();

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

  /**
   *  Qo'lda tuzatish — mukofot yoki jarima.
   *
   *  Hisoblangan raqamni to'g'ridan-to'g'ri tahrirlash noto'g'ri
   *  bo'lardi: u formuladan kelib chiqadi va qayta hisoblaganda
   *  tiklanadi. Soat yoki stavka xato bo'lsa — o'sha SABABNI
   *  tuzatib qayta hisoblash kerak. Formulaga sig'maydigan
   *  holatlar uchun esa alohida qator: u qayta hisoblaganda
   *  o'chmaydi.
   */
  const [adjOpen, setAdjOpen] = useState(false);

  const addAdj = useMutation({
    mutationFn: async (f: {
      description: string; amount: number; reason: string;
    }) => {
      const { error } = await supabase.rpc('add_payroll_adjustment', {
        p_run_id: id!,
        p_description: f.description,
        p_amount: f.amount,
        p_reason: f.reason || undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll-lines', id] });
      qc.invalidateQueries({ queryKey: ['payroll-run', id] });
      toast.ok(t('ux.saved'));
      setAdjOpen(false);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  //  Hisobni butunlay o'chirish — faqat tasdiqlanmaganini.
  const dropRun = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('delete_payroll_run', {
        p_run_id: id!,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll'] });
      toast.ok(t('ux.saved'));
      nav('/oylik');
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (run.isLoading) return <Loading />;
  if (run.error) return <ErrorState message={(run.error as Error).message} />;
  if (!run.data) return <EmptyState />;

  const r = run.data;
  // deno-lint-ignore no-explicit-any
  const teacher = (r as any).teachers;
  const rows = lines.data ?? [];

  //  Yaxlitlash ALOHIDA sanaladi.
  //
  //  Ilgari jamlanma shunchaki musbat va manfiy qatorlarni qo'shardi,
  //  ya'ni yaxlitlash (masalan −36 so'm) "Ushlanmalar" ichiga tushib
  //  ketardi. Natijada ushlanma 379 950 bo'lib ko'rinardi, aslida
  //  soliq 379 914 edi. Buxgalter soliq hisobotini shu raqamdan
  //  olsa — u to'g'ri kelmaydi.
  const isRounding = (l: { source_kind?: string | null }) =>
    l.source_kind === 'rounding';

  const gross = rows.filter((l) => !isRounding(l) && Number(l.amount) > 0)
    .reduce((s, l) => s + Number(l.amount), 0);
  const deductions = rows.filter((l) => !isRounding(l) && Number(l.amount) < 0)
    .reduce((s, l) => s + Number(l.amount), 0);
  const rounding = rows.filter(isRounding)
    .reduce((s, l) => s + Number(l.amount), 0);
  const net = gross + deductions + rounding;

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
            {r.status === 'draft' && mayWrite('payroll.manage') && (
              <Button className="no-print" onClick={() => setAdjOpen(true)}>
                {t('payroll.addAdjustment')}
              </Button>
            )}
            {r.status !== 'approved' && mayWrite('payroll.approve') && (
              <Button
                className="no-print" variant="ghost"
                disabled={dropRun.isPending}
                onClick={() => {
                  if (globalThis.confirm(t('payroll.deleteConfirm'))) {
                    dropRun.mutate();
                  }
                }}
              >
                {t('common.delete')}
              </Button>
            )}
          </>
        }
      />

      {adjOpen && (
        <AdjustmentModal
          onClose={() => setAdjOpen(false)}
          onSubmit={(f) => addAdj.mutate(f)}
          busy={addAdj.isPending}
        />
      )}

      <Card title={t('payroll.sheet')} padded={false}>
        {rows.length === 0 ? <EmptyState /> : (
          <div className="divide-y divide-[var(--border-soft)]">
            {rows.map((l) => {
              const amount = Number(l.amount);
              const negative = amount < 0;
              const details = explain(
                l.source as Record<string, unknown> | null, lang, t);

              return (
                <div key={l.id} className="px-4 py-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="min-w-0">
                      <span className="text-sm font-medium">{l.description}</span>
                      {l.source_kind === 'manual' && (
                        <span className="ml-2 text-[11px] text-[var(--warn)]">
                          {t('payroll.manual')}
                        </span>
                      )}
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
              {rounding !== 0 && (
                <div className="mt-1 flex justify-between text-[13px]">
                  <span className="text-[var(--text-muted)]">
                    {t('payroll.rounding')}
                  </span>
                  <span className="num font-medium">
                    {rounding < 0 ? '−' : '+'}{money(Math.abs(rounding), lang)}
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
          <p className="mb-3 text-[13px] text-[var(--text-muted)]">
            {t('payroll.settingsHint')}
          </p>
          <SettingsSnapshot
            data={r.settings_snapshot as Record<string, unknown>}
            lang={lang}
            t={t}
          />
        </Card>
      )}
    </>
  );
}


/**
 *  Mukofot yoki jarima.
 *
 *  Bitta oynada ikkalasi: farq faqat ishorada. Ikkita alohida shakl
 *  yozish mumkin edi, lekin ular bir xil maydonlarga ega bo'lardi va
 *  vaqt o'tishi bilan biri-biridan ajralib ketardi.
 */
function AdjustmentModal({ onClose, onSubmit, busy }: {
  onClose: () => void;
  onSubmit: (f: {
    description: string; amount: number; reason: string;
  }) => void;
  busy: boolean;
}) {
  const t = useT();
  const [sign, setSign] = useState<'plus' | 'minus'>('minus');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [reason, setReason] = useState('');

  const value = Number(amount || 0);

  return (
    <Modal
      open
      title={t('payroll.addAdjustment')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            disabled={busy || value <= 0 || description.trim().length < 3}
            onClick={() => onSubmit({
              description: description.trim(),
              amount: sign === 'minus' ? -value : value,
              reason,
            })}
          >
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Notice tone="neutral">{t('payroll.adjustmentHint')}</Notice>

        <div className="flex gap-2">
          <Button
            variant={sign === 'minus' ? 'danger' : undefined}
            onClick={() => setSign('minus')}
          >
            {t('payroll.fine')}
          </Button>
          <Button
            variant={sign === 'plus' ? 'accent' : undefined}
            onClick={() => setSign('plus')}
          >
            {t('payroll.bonus')}
          </Button>
        </div>

        <Field label={t('common.amount')} required>
          <MoneyInput value={amount}
                      onChange={(e) => setAmount(e.target.value)} autoFocus />
        </Field>

        <Field label={t('common.note')} required
               hint={t('payroll.adjustmentDescHint')}>
          <Input value={description}
                 onChange={(e) => setDescription(e.target.value)} />
        </Field>

        <Field label={t('pay.cancelReason')}>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
