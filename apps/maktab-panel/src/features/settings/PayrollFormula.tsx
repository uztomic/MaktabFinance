// =====================================================================
//  Oylik formulasi muharriri (TZ 4.11.10).
//
//  "Formula parametrlari KODGA YOZILMAYDI. Stavkalar, tariflar,
//   ustamalar foizi va ushlanma stavkalari SOZLAMADA saqlanadi va
//   maktab bo'yicha farq qilishi mumkin."
//
//  Bu ekran o'sha talabni buxgalter va direktor uchun ochadi:
//  JSON emas, oddiy maydonlar. Ular formulaning BARCHA turini
//  (qat'iy / stavka / soatbay / aralash) va barcha komponentini
//  (ustama, ushlanma, yaxlitlash, davr) o'zi sozlaydi.
//
//  Saqlangan qiymat keyingi `calc_payroll` chaqiruvida darhol
//  qo'llanadi. Tasdiqlangan oyliklar o'zgarmaydi (TZ 4.11.8).
// =====================================================================

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useT } from '@/i18n';
import {
  Button, Card, ErrorState, Field, Input, Loading, MoneyInput, Notice, Select,
} from '@/ui';

// ---------------------------------------------------------------------
//  Formulaning to'liq shakli
// ---------------------------------------------------------------------

type BaseType = 'fixed' | 'rate' | 'hourly' | 'mixed';
type ValueType = 'percent' | 'fixed';

interface NamedRow {
  code: string;
  name: string;
  type: ValueType;
  value: number;
}

interface Formula {
  base_type: BaseType;
  hours_per_rate: number;
  hour_price: number;
  category_factors: Array<{ key: string; value: number }>;
  substitution_percent: number;
  unheld_lesson_policy: Array<{ key: string; value: number }>;
  allowances: NamedRow[];
  deductions: NamedRow[];
  rounding: { step: number; mode: 'nearest' | 'up' | 'down' };
  period: { start_day: number; end_day: number };
}

/** Qaysi maydon qaysi asosiy haq turida ishlatiladi. */
const USED_BY: Record<string, BaseType[]> = {
  hours_per_rate: ['rate'],
  hour_price: ['rate', 'hourly', 'mixed'],
  category_factors: ['rate', 'hourly', 'mixed'],
  substitution_percent: ['fixed', 'rate', 'hourly', 'mixed'],
  unheld_lesson_policy: ['fixed', 'rate', 'hourly', 'mixed'],
};

const BASE_TYPES: BaseType[] = ['fixed', 'rate', 'hourly', 'mixed'];

/** O'tkazilmagan dars uchun tayyor sabablar (buxgalter o'zi ham qo'shadi). */
const UNHELD_PRESETS = ['holiday', 'quarantine', 'teacher_absent', 'default'];

const EMPTY: Formula = {
  base_type: 'fixed',
  hours_per_rate: 24,
  hour_price: 0,
  category_factors: [],
  substitution_percent: 100,
  unheld_lesson_policy: [],
  allowances: [],
  deductions: [],
  rounding: { step: 1000, mode: 'nearest' },
  period: { start_day: 1, end_day: 0 },
};

// --- jsonb ↔ forma shakli --------------------------------------------

function objToRows(v: unknown): Array<{ key: string; value: number }> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return [];
  return Object.entries(v as Record<string, unknown>).map(([key, raw]) => ({
    key,
    value: typeof raw === 'object' && raw !== null
      ? Number((raw as { paid_percent?: number }).paid_percent ?? 0)
      : Number(raw ?? 0),
  }));
}

function rowsToObj(rows: Array<{ key: string; value: number }>) {
  const out: Record<string, number> = {};
  for (const r of rows) if (r.key.trim()) out[r.key.trim()] = Number(r.value) || 0;
  return out;
}

function rowsToPolicy(rows: Array<{ key: string; value: number }>) {
  const out: Record<string, { paid_percent: number }> = {};
  for (const r of rows) {
    if (r.key.trim()) out[r.key.trim()] = { paid_percent: Number(r.value) || 0 };
  }
  return out;
}

function toNamedRows(v: unknown): NamedRow[] {
  if (!Array.isArray(v)) return [];
  return v.map((r) => ({
    code: String(r?.code ?? ''),
    name: String(r?.name ?? ''),
    type: r?.type === 'percent' ? 'percent' : 'fixed',
    value: Number(r?.value ?? 0),
  }));
}

// =====================================================================

export default function PayrollFormula({ editable }: { editable: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const { profile } = useAuth();

  const [form, setForm] = useState<Formula>(EMPTY);
  const [showJson, setShowJson] = useState(false);
  const [saved, setSaved] = useState(false);

  const rows = useQuery({
    //  ATAYLAB BOSHQA KALIT.
    //
    //  `usePayrollSettings` (SalaryPreview) ham shu jadvalni o'qiydi,
    //  lekin ODDIY OBYEKT qaytaradi. Bu yerda esa Map kerak: saqlashda
    //  har qatorning `id` si ishlatiladi.
    //
    //  Ikkalasi bitta kalitda edi va kesh oxirgi yugurgan so'rovga
    //  tegishli bo'lib qolardi. Natijada o'qituvchilar sahifasidan
    //  keyin sozlamalarga kirilsa, Map o'rniga obyekt kelib
    //  "data.get is not a function" xatosi chiqardi — ya'ni xato
    //  sahifaning O'ZIDA emas, KIRISH TARTIBIDA edi.
    queryKey: ['payroll-settings-edit'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payroll_settings')
        .select('id, key, value, effective_from')
        .order('effective_from', { ascending: false });
      if (error) throw error;
      const m = new Map<string, { id: string; value: unknown }>();
      for (const r of data ?? []) {
        if (!m.has(r.key)) m.set(r.key, { id: r.id, value: r.value });
      }
      return m;
    },
  });

  // Bazadagi qiymatlarni formaga yig'amiz.
  const loaded = useMemo<Formula | null>(() => {
    if (!rows.data) return null;
    const g = (k: string) => rows.data!.get(k)?.value;
    const num = (k: string, d: number) => {
      const v = g(k);
      const n = Number(typeof v === 'string' ? v.replace(/"/g, '') : v);
      return Number.isFinite(n) ? n : d;
    };

    const base = String(g('base_type') ?? 'fixed').replace(/"/g, '') as BaseType;
    const round = (g('rounding') ?? {}) as { step?: number; mode?: string };
    const per = (g('period') ?? {}) as { start_day?: number; end_day?: number };

    return {
      base_type: BASE_TYPES.includes(base) ? base : 'fixed',
      hours_per_rate: num('hours_per_rate', 24),
      hour_price: num('hour_price', 0),
      category_factors: objToRows(g('category_factors')),
      substitution_percent: num('substitution_percent', 100),
      unheld_lesson_policy: objToRows(g('unheld_lesson_policy')),
      allowances: toNamedRows(g('allowances')),
      deductions: toNamedRows(g('deductions')),
      rounding: {
        step: Number(round.step ?? 1000),
        mode: (['nearest', 'up', 'down'].includes(String(round.mode))
          ? round.mode
          : 'nearest') as 'nearest' | 'up' | 'down',
      },
      period: {
        start_day: Number(per.start_day ?? 1),
        end_day: Number(per.end_day ?? 0),
      },
    };
  }, [rows.data]);

  useEffect(() => {
    if (loaded) setForm(loaded);
  }, [loaded]);

  const dirty = useMemo(
    () => loaded !== null && JSON.stringify(loaded) !== JSON.stringify(form),
    [loaded, form],
  );

  // --- Saqlash: faqat o'zgargan kalitlar --------------------------
  const save = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        base_type: form.base_type,
        hours_per_rate: form.hours_per_rate,
        hour_price: form.hour_price,
        category_factors: rowsToObj(form.category_factors),
        substitution_percent: form.substitution_percent,
        unheld_lesson_policy: rowsToPolicy(form.unheld_lesson_policy),
        allowances: form.allowances
          .filter((a) => a.code.trim())
          .map((a) => ({ ...a, value: Number(a.value) || 0 })),
        deductions: form.deductions
          .filter((d) => d.code.trim())
          .map((d) => ({ ...d, value: Number(d.value) || 0 })),
        rounding: form.rounding,
        period: form.period,
      };

      for (const [key, value] of Object.entries(payload)) {
        const existing = rows.data?.get(key);
        if (existing && JSON.stringify(existing.value) === JSON.stringify(value)) {
          continue;   // o'zgarmagan — tegmaymiz
        }
        if (existing) {
          const { error } = await supabase
            .from('payroll_settings')
            .update({
              value: value as never,
              updated_by: profile!.id,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existing.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from('payroll_settings').insert({
            school_id: profile!.school_id,
            key,
            value: value as never,
            updated_by: profile!.id,
          });
          if (error) throw error;
        }
      }
    },
    onSuccess: () => {
      //  Ikkala kesh ham yangilanadi: oylik ko'rinishi (SalaryPreview)
      //  o'sha sozlamalarga tayanadi.
      qc.invalidateQueries({ queryKey: ['payroll-settings-edit'] });
      qc.invalidateQueries({ queryKey: ['payroll-settings'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  if (rows.isLoading) return <Loading />;
  if (rows.error) return <ErrorState message={(rows.error as Error).message} />;

  const set = <K extends keyof Formula>(k: K, v: Formula[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  /** Maydon joriy asosiy haq turida ishlatiladimi? */
  const used = (key: string) =>
    !USED_BY[key] || USED_BY[key].includes(form.base_type);

  return (
    <div className="space-y-4 pb-24">
      <Notice tone="neutral">{t('pf.intro')}</Notice>

      {/* ============ 1. ASOSIY HAQ TURI ============ */}
      <Card title={t('pf.base.title')}>
        {/*  Bu MAKTAB uchun standart. Har bir xodimga alohida tur
             belgilash mumkin — aks holda soatbay ishlaydigan to'garak
             rahbari ham qat'iy oylik oladigan bo'lib qolardi. */}
        <p className="mb-3 text-[13px] text-[var(--text-muted)]">
          {t('pf.base.schoolDefault')}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {BASE_TYPES.map((bt) => {
            const active = form.base_type === bt;
            return (
              <button
                key={bt}
                type="button"
                disabled={!editable}
                onClick={() => set('base_type', bt)}
                className={`rounded-lg border p-3 text-left transition-colors
                  ${active
                    ? 'border-[var(--sel-border)] bg-[var(--sel-bg)] ring-1 ring-[var(--sel-border)]'
                    : 'hover:bg-[var(--bg-subtle)]'}
                  disabled:cursor-not-allowed`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center
                      rounded-full border-2
                      ${active ? 'border-brand-700' : 'border-[var(--text-faint)]'}`}
                  >
                    {active && (
                      <span className="h-2 w-2 rounded-full bg-brand-700" />
                    )}
                  </span>
                  <span className={`text-sm font-medium
                    ${active ? 'text-[var(--sel-text)]' : ''}`}>
                    {t(`pf.base.${bt}`)}
                  </span>
                </div>
                <p className={`mt-1 pl-6 text-[12px]
                  ${active ? 'text-brand-800' : 'text-[var(--text-muted)]'}`}>
                  {t(`pf.base.${bt}.hint`)}
                </p>
              </button>
            );
          })}
        </div>
      </Card>

      {/* ============ 2. STAVKA VA SOAT ============ */}
      <Card title={`${t('pf.hoursPerRate')} / ${t('pf.hourPrice')}`}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Dim on={used('hours_per_rate')} usedBy={USED_BY.hours_per_rate}>
            <Field label={t('pf.hoursPerRate')} hint={t('pf.hoursPerRate.hint')}>
              <Input
                type="number" min={0} step={0.5}
                value={form.hours_per_rate}
                disabled={!editable}
                onChange={(e) => set('hours_per_rate', Number(e.target.value))}
              />
            </Field>
          </Dim>

          <Dim on={used('hour_price')} usedBy={USED_BY.hour_price}>
            <Field label={t('pf.hourPrice')} hint={t('pf.hourPrice.hint')}>
              <MoneyInput
                value={form.hour_price}
                disabled={!editable}
                onChange={(e) => set('hour_price', Number(e.target.value))}
              />
            </Field>
          </Dim>
        </div>
      </Card>

      {/* ============ 3. TOIFA KOEFFITSIYENTLARI ============ */}
      <Dim on={used('category_factors')} usedBy={USED_BY.category_factors}>
        <Card title={t('pf.categories')}>
          <p className="mb-3 text-[12px] text-[var(--text-muted)]">
            {t('pf.categories.hint')}
          </p>
          <KeyValueRows
            rows={form.category_factors}
            editable={editable}
            keyLabel={t('pf.categories.name')}
            valueLabel={t('pf.categories.factor')}
            keyPlaceholder="oliy"
            step={0.05}
            onChange={(v) => set('category_factors', v)}
          />
        </Card>
      </Dim>

      {/* ============ 4. DARSLAR ============ */}
      <Card title={t('lessons.title')}>
        <div className="space-y-4">
          <Field label={t('pf.substitution')} hint={t('pf.substitution.hint')}>
            <div className="flex items-center gap-2">
              <Input
                type="number" min={0} max={300}
                value={form.substitution_percent}
                disabled={!editable}
                onChange={(e) =>
                  set('substitution_percent', Number(e.target.value))}
                className="max-w-[8rem] text-right"
              />
              <span className="text-sm text-[var(--text-muted)]">%</span>
            </div>
          </Field>

          <div className="border-t pt-4">
            <div className="mb-1 text-[13px] font-medium text-[var(--text-muted)]">
              {t('pf.unheld')}
            </div>
            <p className="mb-3 text-[12px] text-[var(--text-muted)]">
              {t('pf.unheld.hint')}
            </p>
            <KeyValueRows
              rows={form.unheld_lesson_policy}
              editable={editable}
              keyLabel={t('pf.unheld.reason')}
              valueLabel={t('pf.unheld.percent')}
              keyPlaceholder="holiday"
              suggestions={UNHELD_PRESETS}
              step={5}
              suffix="%"
              onChange={(v) => set('unheld_lesson_policy', v)}
            />
          </div>
        </div>
      </Card>

      {/* ============ 5. USTAMALAR ============ */}
      <Card title={t('pf.allowances')}>
        <p className="mb-3 text-[12px] text-[var(--text-muted)]">
          {t('pf.allowances.hint')} {t('pf.allowances.free')}
        </p>
        <NamedRows
          rows={form.allowances}
          editable={editable}
          onChange={(v) => set('allowances', v)}
        />
      </Card>

      {/* ============ 6. USHLANMALAR ============ */}
      <Card title={t('pf.deductions')}>
        <p className="mb-3 text-[12px] text-[var(--text-muted)]">
          {t('pf.deductions.hint')}
        </p>
        <NamedRows
          rows={form.deductions}
          editable={editable}
          onChange={(v) => set('deductions', v)}
        />
      </Card>

      {/* ============ 7. YAXLITLASH VA DAVR ============ */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('pf.rounding')}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('pf.rounding.step')} hint={t('pf.rounding.step.hint')}>
              <Select
                value={String(form.rounding.step)}
                disabled={!editable}
                onChange={(e) =>
                  set('rounding', { ...form.rounding, step: Number(e.target.value) })}
              >
                <option value="1">1</option>
                <option value="100">100</option>
                <option value="500">500</option>
                <option value="1000">1 000</option>
                <option value="5000">5 000</option>
                <option value="10000">10 000</option>
              </Select>
            </Field>
            <Field label={t('pf.rounding.mode')}>
              <Select
                value={form.rounding.mode}
                disabled={!editable}
                onChange={(e) =>
                  set('rounding', {
                    ...form.rounding,
                    mode: e.target.value as 'nearest' | 'up' | 'down',
                  })}
              >
                <option value="nearest">{t('pf.rounding.nearest')}</option>
                <option value="up">{t('pf.rounding.up')}</option>
                <option value="down">{t('pf.rounding.down')}</option>
              </Select>
            </Field>
          </div>
        </Card>

        <Card title={t('pf.period')}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('pf.period.start')}>
              <Input
                type="number" min={1} max={28}
                value={form.period.start_day}
                disabled={!editable}
                onChange={(e) =>
                  set('period', { ...form.period, start_day: Number(e.target.value) })}
              />
            </Field>
            <Field label={t('pf.period.end')} hint={t('pf.period.endHint')}>
              <Input
                type="number" min={0} max={31}
                value={form.period.end_day}
                disabled={!editable}
                onChange={(e) =>
                  set('period', { ...form.period, end_day: Number(e.target.value) })}
              />
            </Field>
          </div>
        </Card>
      </div>

      {/* ============ KENGAYTIRILGAN ============ */}
      <Card
        title={t('pf.advanced')}
        action={
          <Button size="sm" variant="ghost" onClick={() => setShowJson((v) => !v)}>
            {showJson ? t('common.close') : t('common.edit')}
          </Button>
        }
      >
        <p className="text-[12px] text-[var(--text-muted)]">
          {t('pf.advanced.hint')}
        </p>
        {showJson && (
          <pre className="mt-3 max-h-72 overflow-auto rounded bg-[var(--bg-inset)]
            p-3 text-[11px] leading-relaxed text-[var(--text-muted)]">
{JSON.stringify({
  base_type: form.base_type,
  hours_per_rate: form.hours_per_rate,
  hour_price: form.hour_price,
  category_factors: rowsToObj(form.category_factors),
  substitution_percent: form.substitution_percent,
  unheld_lesson_policy: rowsToPolicy(form.unheld_lesson_policy),
  allowances: form.allowances,
  deductions: form.deductions,
  rounding: form.rounding,
  period: form.period,
}, null, 2)}
          </pre>
        )}
      </Card>

      {/* ============ SAQLASH PANELI ============ */}
      {editable && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-[var(--bg)]/95
          px-4 py-3 backdrop-blur md:pl-60">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
            <span className="text-[13px] text-[var(--text-muted)]">
              {save.error
                ? <span className="text-[var(--danger)]">
                    {(save.error as Error).message}
                  </span>
                : saved
                ? <span className="text-[var(--ok)]">✓ {t('pf.saved')}</span>
                : dirty
                ? t('pf.unsaved')
                : t('pf.warning')}
            </span>
            <Button
              variant={dirty ? 'primary' : 'secondary'}
              onClick={() => save.mutate()}
              disabled={!dirty || save.isPending}
            >
              {save.isPending ? t('common.saving') : t('pf.saveAll')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
//  Joriy turda ishlatilmaydigan maydonni xiralashtiradi.
//  Yashirmaymiz — buxgalter formulaning to'liq tarkibini ko'rib tursin.
// ---------------------------------------------------------------------

function Dim({
  on, usedBy, children,
}: {
  on: boolean;
  /** Qaysi asosiy haq turlarida ishlatiladi — foydalanuvchiga ko'rsatiladi. */
  usedBy?: BaseType[];
  children: React.ReactNode;
}) {
  const t = useT();
  if (on) return <>{children}</>;

  return (
    <div className="relative">
      <div className="pointer-events-none opacity-40">{children}</div>
      {usedBy && (
        <span
          className="absolute right-3 top-3 z-10 rounded bg-[var(--bg-inset)] px-2
            py-0.5 text-[10px] font-medium text-[var(--text-faint)]"
        >
          {t('pf.base.uses')}: {usedBy.map((b) => t(`pf.base.${b}`)).join(', ')}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
//  Kalit → qiymat qatorlari (toifalar, o'tkazilmagan dars qoidasi)
// ---------------------------------------------------------------------

function KeyValueRows({
  rows, editable, keyLabel, valueLabel, keyPlaceholder,
  suggestions, step = 1, suffix, onChange,
}: {
  rows: Array<{ key: string; value: number }>;
  editable: boolean;
  keyLabel: string;
  valueLabel: string;
  keyPlaceholder?: string;
  suggestions?: string[];
  step?: number;
  suffix?: string;
  onChange: (rows: Array<{ key: string; value: number }>) => void;
}) {
  const t = useT();

  const update = (i: number, patch: Partial<{ key: string; value: number }>) =>
    onChange(rows.map((r, idx) => idx === i ? { ...r, ...patch } : r));

  return (
    <div className="space-y-2">
      {rows.length === 0 && (
        <p className="text-[12px] text-[var(--text-faint)]">{t('pf.row.empty')}</p>
      )}

      {rows.length > 0 && (
        <div className="hidden gap-2 px-1 text-[11px] font-medium uppercase
          tracking-wide text-[var(--text-muted)] sm:flex">
          <span className="flex-1">{keyLabel}</span>
          <span className="w-32">{valueLabel}</span>
          <span className="w-8" />
        </div>
      )}

      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <Input
            value={r.key}
            disabled={!editable}
            placeholder={keyPlaceholder}
            list={suggestions ? 'kv-suggestions' : undefined}
            onChange={(e) => update(i, { key: e.target.value })}
            className="min-w-[10rem] flex-1"
          />
          <div className="flex w-32 items-center gap-1">
            <Input
              type="number" step={step}
              value={r.value}
              disabled={!editable}
              onChange={(e) => update(i, { value: Number(e.target.value) })}
              className="num text-right"
            />
            {suffix && (
              <span className="text-[12px] text-[var(--text-muted)]">{suffix}</span>
            )}
          </div>
          {editable && (
            <button
              type="button"
              onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
              title={t('pf.row.remove')}
              className="flex h-9 w-8 items-center justify-center rounded
                text-[var(--text-faint)] hover:bg-[var(--danger-bg)]
                hover:text-[var(--danger)]"
            >
              ✕
            </button>
          )}
        </div>
      ))}

      {suggestions && (
        <datalist id="kv-suggestions">
          {suggestions.map((s) => <option key={s} value={s} />)}
        </datalist>
      )}

      {editable && (
        <Button
          size="sm"
          onClick={() => onChange([...rows, { key: '', value: 0 }])}
        >
          + {t('pf.row.add')}
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
//  Nomlangan qatorlar (ustamalar, ushlanmalar)
// ---------------------------------------------------------------------

/**
 *  Nomdan ichki kod yasaydi: "Ish staji uchun" → "ish_staji_uchun".
 *
 *  NEGA KERAK. Ilgari foydalanuvchi kodni QO'LDA yozardi va jadvalda
 *  alohida "KOD" ustuni turardi. Direktor uchun bu tushunarsiz: u
 *  ustama nomini biladi, ichki belgini emas. Natijada yangi ustama
 *  qo'shish o'rniga mavjudini o'zgartirib yuborish yoki umuman
 *  qo'shmaslik holatlari kelib chiqardi.
 *
 *  Endi kod ko'rinmaydi va o'zi yasaladi. Lotin harfi bo'lmagan
 *  nomlar uchun (masalan kirillcha) zaxira sifatida tartib raqami
 *  ishlatiladi — kod baribir ichki belgi, uni odam o'qimaydi.
 */
function makeCode(name: string, taken: string[]): string {
  const base = name
    .toLowerCase()
    .replace(/['''`]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 28);

  let code = base || 'ustama';
  let n = 2;
  while (taken.includes(code)) {
    code = `${base || 'ustama'}_${n}`;
    n += 1;
  }
  return code;
}

function NamedRows({
  rows, editable, onChange,
}: {
  rows: NamedRow[];
  editable: boolean;
  onChange: (rows: NamedRow[]) => void;
}) {
  const t = useT();

  const update = (i: number, patch: Partial<NamedRow>) =>
    onChange(rows.map((r, idx) => idx === i ? { ...r, ...patch } : r));

  return (
    <div className="space-y-2">
      {rows.length === 0 && (
        <p className="text-[12px] text-[var(--text-faint)]">{t('pf.row.empty')}</p>
      )}

      {rows.length > 0 && (
        <div className="hidden gap-2 px-1 text-[11px] font-medium uppercase
          tracking-wide text-[var(--text-muted)] lg:flex">
          <span className="flex-1">{t('pf.row.name')}</span>
          <span className="w-40">{t('pf.row.type')}</span>
          <span className="w-36">{t('pf.row.value')}</span>
          <span className="w-8" />
        </div>
      )}

      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <Input
            value={r.name}
            disabled={!editable}
            placeholder={t('pf.row.namePlaceholder')}
            onChange={(e) => {
              const name = e.target.value;
              //  Kod FAQAT yangi qatorda yasaladi. Mavjud ustamaning
              //  kodi o'zgarsa, unga biriktirilgan o'qituvchilar
              //  bilan bog'lanish uziladi va ustama jim yo'qoladi.
              const patch = r.code
                ? { name }
                : {
                  name,
                  code: makeCode(
                    name,
                    rows.filter((_, idx) => idx !== i).map((x) => x.code),
                  ),
                };
              update(i, patch);
            }}
            className="min-w-[12rem] flex-1"
          />
          <Select
            value={r.type}
            disabled={!editable}
            onChange={(e) => update(i, { type: e.target.value as ValueType })}
            className="w-40"
          >
            <option value="fixed">{t('pf.row.fixed')}</option>
            <option value="percent">{t('pf.row.percent')}</option>
          </Select>
          <div className="flex w-36 items-center gap-1">
            {r.type === 'percent'
              ? (
                <>
                  <Input
                    type="number" min={0} max={100} step={0.5}
                    value={r.value}
                    disabled={!editable}
                    onChange={(e) => update(i, { value: Number(e.target.value) })}
                    className="num text-right"
                  />
                  <span className="text-[12px] text-[var(--text-muted)]">%</span>
                </>
              )
              : (
                <MoneyInput
                  value={r.value}
                  disabled={!editable}
                  onChange={(e) => update(i, { value: Number(e.target.value) })}
                />
              )}
          </div>
          {editable && (
            <button
              type="button"
              onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
              title={t('pf.row.remove')}
              className="flex h-9 w-8 items-center justify-center rounded
                text-[var(--text-faint)] hover:bg-[var(--danger-bg)]
                hover:text-[var(--danger)]"
            >
              ✕
            </button>
          )}
        </div>
      ))}

      {editable && (
        <Button
          size="sm"
          onClick={() =>
            onChange([...rows, { code: '', name: '', type: 'fixed', value: 0 }])}
        >
          + {t('pf.row.add')}
        </Button>
      )}
    </div>
  );
}
