// =====================================================================
//  Tarif + chegirma — o'quvchi qo'shishda va shartnomada bir xil.
//
//  Narx QO'LDA YOZILMAYDI: sinfga mos tarif o'zi tanlanadi (Sozlamalar →
//  Tariflar). Chegirma shu narxdan: katalogdagi tur ("2-farzand") yoki
//  qo'lda — "qancha to'laydi", foiz yoki summa. Qo'lda chegirmada sabab
//  majburiy. Natija pastda: asl narx → chegirma → to'laydi.
// =====================================================================

import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useI18n, useT } from '@/i18n';
import { money } from '@/lib/format';
import { Field, Input, MoneyInput, Segmented, Select } from '@/ui';

export type DiscMode = 'pays' | 'percent' | 'amount';

export interface TuitionValue {
  /** '' — tanlanmagan, 'custom' — boshqa narx (qo'lda). */
  plan_id: string;
  custom_amount: string;
  /** '' — chegirmasiz, 'manual' — qo'lda, aks holda discount_types.id. */
  discount: string;
  mode: DiscMode;
  value: string;
  reason: string;
}

export const emptyTuition = (): TuitionValue => ({
  plan_id: '', custom_amount: '', discount: '', mode: 'pays', value: '', reason: '',
});

export interface TuitionPlan {
  id: string; name: string; academic_year: string | null;
  grade_from: number | null; grade_to: number | null; monthly_amount: number;
}

export function useTuitionPlans() {
  return useQuery({
    queryKey: ['tuition-plans'],
    queryFn: async () => {
      const { data, error } = await supabase.from('tuition_plans')
        .select('id, name, academic_year, grade_from, grade_to, monthly_amount')
        .eq('is_active', true).order('sort_order').order('name');
      if (error) throw error;
      return (data ?? []) as TuitionPlan[];
    },
  });
}

/** Sinf darajasiga mos tarif (eng tor oraliq). */
export function planForGrade(plans: TuitionPlan[], grade: number | null): TuitionPlan | null {
  if (grade === null) return null;
  const fit = plans.filter((p) =>
    (p.grade_from === null || p.grade_from <= grade) &&
    (p.grade_to === null || grade <= p.grade_to));
  fit.sort((a, b) => ((a.grade_to ?? 99) - (a.grade_from ?? 0)) - ((b.grade_to ?? 99) - (b.grade_from ?? 0)));
  return fit[0] ?? null;
}

/** Bazaga yoziladigan ko'rinish: narx, chegirma turi/qiymati, sabab. */
export function resolveTuition(v: TuitionValue, plans: TuitionPlan[],
  types: Array<{ id: string; kind: string; value: number }>) {
  const plan = plans.find((p) => p.id === v.plan_id);
  const base = v.plan_id === 'custom' ? Number(v.custom_amount) || 0 : Number(plan?.monthly_amount ?? 0);
  const raw = Number(v.value) || 0;
  const typed = types.find((d) => d.id === v.discount);
  let kind: 'percent' | 'amount' | null = null;
  let stored: number | null = null;
  let sum = 0;
  if (v.discount === 'manual' && raw > 0) {
    if (v.mode === 'percent') { kind = 'percent'; stored = Math.min(100, raw); sum = Math.round(base * stored / 100); }
    else if (v.mode === 'pays') { kind = 'amount'; stored = Math.max(0, base - raw); sum = stored; }
    else { kind = 'amount'; stored = Math.min(raw, base); sum = stored; }
  } else if (typed) {
    sum = typed.kind === 'percent' ? Math.round(base * Number(typed.value) / 100) : Math.min(Number(typed.value), base);
  }
  return {
    base,
    plan_id: v.plan_id && v.plan_id !== 'custom' ? v.plan_id : null,
    discount_type_id: typed ? typed.id : null,
    discount_kind: kind,
    discount_value: stored,
    discount_reason: v.discount === 'manual' ? v.reason.trim() || null : null,
    discountSum: sum,
    pays: Math.max(0, base - sum),
    reasonMissing: v.discount === 'manual' && raw > 0 && !v.reason.trim(),
    paysTooHigh: v.discount === 'manual' && v.mode === 'pays' && raw > base,
  };
}

export function useDiscountTypes() {
  return useQuery({
    queryKey: ['discount-types'],
    queryFn: async () => {
      const { data, error } = await supabase.from('discount_types')
        .select('id, code, name, kind, value').eq('is_active', true).order('name');
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function TuitionPicker({ value, onChange, grade }: {
  value: TuitionValue;
  onChange: (v: TuitionValue) => void;
  /** Sinf darajasi — tarif o'zi tanlanadi. */
  grade: number | null;
}) {
  const t = useT();
  const { lang } = useI18n();
  const plans = useTuitionPlans();
  const types = useDiscountTypes();
  const set = (patch: Partial<TuitionValue>) => onChange({ ...value, ...patch });

  //  Sinf o'zgarsa — mos tarif avtomatik (qo'lda tanlanmagan bo'lsa).
  const auto = useMemo(() => planForGrade(plans.data ?? [], grade), [plans.data, grade]);
  useEffect(() => {
    if (auto && (value.plan_id === '' || (plans.data ?? []).some((p) => p.id === value.plan_id))) {
      if (value.plan_id !== auto.id) set({ plan_id: auto.id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto?.id]);

  const r = resolveTuition(value, plans.data ?? [],
    (types.data ?? []).map((d) => ({ id: d.id, kind: d.kind, value: Number(d.value) })));

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('tp.plan')} required>
          <Select value={value.plan_id} onChange={(e) => set({ plan_id: e.target.value })}>
            <option value="">—</option>
            {(plans.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}{p.academic_year ? ` (${p.academic_year})` : ''} — {money(p.monthly_amount, lang)}
              </option>
            ))}
            <option value="custom">{t('tp.custom')}</option>
          </Select>
        </Field>
        {value.plan_id === 'custom'
          ? (
            <Field label={t('contracts.tuition')} required>
              <MoneyInput value={value.custom_amount} onChange={(e) => set({ custom_amount: e.target.value })} />
            </Field>
          )
          : (
            <Field label={t('contracts.discountType')}>
              <Select value={value.discount} onChange={(e) => set({ discount: e.target.value, value: '' })}>
                <option value="">{t('contracts.discountNone')}</option>
                {(types.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} — {d.kind === 'percent' ? `${Number(d.value)}%` : money(d.value, lang)}
                  </option>
                ))}
                <option value="manual">{t('contracts.discountManual')}</option>
              </Select>
            </Field>
          )}
      </div>

      {value.plan_id === 'custom' && (
        <Field label={t('contracts.discountType')}>
          <Select value={value.discount} onChange={(e) => set({ discount: e.target.value, value: '' })}>
            <option value="">{t('contracts.discountNone')}</option>
            {(types.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
            <option value="manual">{t('contracts.discountManual')}</option>
          </Select>
        </Field>
      )}

      {value.discount === 'manual' && (
        <div className="space-y-3 rounded-xl border p-3">
          <Segmented<DiscMode>
            value={value.mode}
            onChange={(m) => set({ mode: m, value: '' })}
            options={[
              { value: 'pays', label: t('disc.mode.pays') },
              { value: 'percent', label: t('disc.mode.percent') },
              { value: 'amount', label: t('disc.mode.amount') },
            ]}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t(`disc.mode.${value.mode}.label`)}
                   error={r.paysTooHigh ? t('disc.paysTooHigh') : undefined}>
              {value.mode === 'percent'
                ? (
                  <span className="relative block">
                    <Input type="number" min={0} max={100} step="0.1" value={value.value}
                           onChange={(e) => set({ value: e.target.value })}
                           className="num pr-8 text-right" />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2
                      text-[13px] text-[var(--text-faint)]">%</span>
                  </span>
                )
                : <MoneyInput value={value.value} onChange={(e) => set({ value: e.target.value })} />}
            </Field>
            <Field label={t('disc.reason')} required
                   error={r.reasonMissing ? t('disc.reasonRequired') : undefined}>
              <Input value={value.reason} onChange={(e) => set({ reason: e.target.value })}
                     placeholder={t('disc.reasonPlaceholder')} />
            </Field>
          </div>
        </div>
      )}

      {r.base > 0 && (
        <div className="grid grid-cols-3 gap-2 rounded-xl bg-[var(--bg-subtle)] p-3 text-center">
          <div>
            <div className="text-[11.5px] text-[var(--text-faint)]">{t('disc.base')}</div>
            <div className={`num text-[14px] ${r.discountSum > 0 ? 'text-[var(--text-muted)] line-through' : 'font-medium'}`}>
              {money(r.base, lang)}
            </div>
          </div>
          <div>
            <div className="text-[11.5px] text-[var(--text-faint)]">{t('disc.discount')}</div>
            <div className="num text-[14px] font-medium text-[var(--danger)]">
              {r.discountSum > 0
                ? <>−{money(r.discountSum, lang)} <span className="text-[12px]">({Math.round((r.discountSum / r.base) * 1000) / 10}%)</span></>
                : '—'}
            </div>
          </div>
          <div>
            <div className="text-[11.5px] text-[var(--text-faint)]">{t('disc.pays')}</div>
            <div className="num text-[15px] font-semibold text-[var(--ok)]">{money(r.pays, lang)}</div>
          </div>
        </div>
      )}
    </div>
  );
}
