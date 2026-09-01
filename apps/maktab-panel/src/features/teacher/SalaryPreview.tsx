// =====================================================================
//  Oylik hisobining JONLI KO'RINISHI — o'qituvchi qo'shayotganda.
//
//  MUAMMO: formada "stavka ulushi", "haftalik soat" va "asosiy oylik"
//  maydonlari bor, lekin ular bir-biriga qanday bog'lanishi va odam
//  oxirida qo'liga qancha olishi ko'rinmasdi. Direktor 5 000 000 deb
//  yozadi, o'qituvchi 4 400 000 oladi va oy oxirida savol tug'iladi.
//
//  Bu yerda butun zanjir ochiq ko'rsatiladi:
//
//      asosiy oylik × stavka ulushi   = asosiy haq
//      + ustamalar                    = jami hisoblangan
//      − ushlanmalar (soliq)          = QO'LGA TEGADIGAN SUMMA
//
//  Bu TAXMIN: o'tilgan darslar, o'rniga kirishlar va avanslar oy
//  davomida qo'shiladi. Shuning uchun "taxminiy" deb belgilanadi va
//  hech qachon haqiqiy hisob o'rniga ishlatilmaydi — haqiqiysini
//  faqat server `calc_payroll` orqali chiqaradi (TZ 4.11.11).
// =====================================================================

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useI18n, useT } from '@/i18n';
import { money } from '@/lib/format';

type Allowance = { code: string; name: string; type: string; value: number };
type Deduction = { code: string; name: string; type: string; value: number };

/** Maktabning joriy oylik sozlamalari (har kalit bo'yicha eng oxirgisi). */
export function usePayrollSettings() {
  return useQuery({
    queryKey: ['payroll-settings'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payroll_settings')
        .select('key, value, effective_from')
        .order('effective_from', { ascending: true });
      if (error) throw error;

      // Bir kalit bir necha marta uchraydi (sozlama tarixi). Eng
      // oxirgi kuchga kirgani olinadi — ro'yxat o'sish tartibida
      // kelgani uchun keyingisi oldingisini almashtiradi.
      const map: Record<string, unknown> = {};
      for (const row of data ?? []) map[row.key] = row.value;
      return map;
    },
  });
}

export function SalaryPreview({
  baseSalary, rateFactor, weeklyHours, category, baseType, hourPrice,
}: {
  baseSalary: string;
  rateFactor: string;
  weeklyHours: string;
  category: string;
  /** Xodimning o'z turi. Bo'sh bo'lsa maktab sozlamasi. */
  baseType?: string;
  /** Shaxsiy soat narxi. Bo'sh bo'lsa maktabniki. */
  hourPrice?: string;
}) {
  const t = useT();
  const { lang } = useI18n();
  const settings = usePayrollSettings();

  if (settings.isLoading) return null;

  const s = settings.data ?? {};
  //  Xodimga tur tanlangan bo'lsa u ustun turadi — hisob aynan
  //  `calc_payroll` dagidek bo'lsin, aks holda oldindan ko'rsatilgan
  //  raqam haqiqiy oylikdan farq qiladi va ishonchni yo'qotadi.
  const effectiveType = baseType || (s.base_type as string) || 'fixed';
  //  Shaxsiy narx maktabnikidan USTUN — `calc_payroll` da ham
  //  shunday (`coalesce(t.hour_price, sozlama)`). Ikkalasi bir xil
  //  bo'lishi shart: aks holda bu yerda ko'rsatilgan raqam oy
  //  oxirida chiqadigan oylikdan farq qiladi.
  const schoolHourPrice = Number(s.hour_price ?? 0);
  const price = Number(hourPrice || 0) || schoolHourPrice;
  const hoursPerRate = Number(s.hours_per_rate ?? 0);
  const factors = (s.category_factors ?? {}) as Record<string, number>;
  const allowances = (s.allowances ?? []) as Allowance[];
  const deductions = (s.deductions ?? []) as Deduction[];

  const salary = Number(baseSalary || 0);
  const rate = Number(rateFactor || 0);
  const hours = Number(weeklyHours || 0);
  const factor = Number(factors[category] ?? 1);

  // --- Asosiy haq — oylik turiga qarab ------------------------------
  let base = 0;
  let formula = '';

  if (effectiveType === 'fixed') {
    base = salary * rate;
    formula = `${money(salary, lang)} × ${rate}`;
  } else if (effectiveType === 'rate') {
    base = hoursPerRate * rate * price * factor;
    formula = `${hoursPerRate} × ${rate} × ${money(price, lang)}`
      + (factor !== 1 ? ` × ${factor}` : '');
  } else if (effectiveType === 'hourly') {
    // Oyda o'rtacha 4.33 hafta. Haqiqiy soat dars jurnalidan olinadi.
    base = hours * 4.33 * price * factor;
    formula = `${hours} × 4.33 × ${money(price, lang)}`
      + (factor !== 1 ? ` × ${factor}` : '');
  } else {
    base = hours * 4.33 * price * factor + salary * rate;
    formula = `${hours} × 4.33 × ${money(price, lang)} + ${money(salary, lang)} × ${rate}`;
  }

  // --- Ustamalar -----------------------------------------------------
  //  Ustama KIMGA tegishli ekani alohida saqlanadi. Yangi o'qituvchida
  //  hali hech qanday ustama biriktirilmagan, shuning uchun ular
  //  "biriktirilsa qo'shiladi" deb alohida ko'rsatiladi.
  const allowanceRows = allowances
    .filter((a) => Number(a.value) > 0)
    .map((a) => ({
      name: a.name,
      amount: a.type === 'percent' ? base * Number(a.value) / 100 : Number(a.value),
      label: a.type === 'percent' ? `${a.value}%` : money(a.value, lang),
    }));

  const gross = base;

  // --- Ushlanmalar ----------------------------------------------------
  const deductionRows = deductions.map((d) => ({
    name: d.name,
    amount: d.type === 'percent' ? gross * Number(d.value) / 100 : Number(d.value),
    label: d.type === 'percent' ? `${d.value}%` : money(d.value, lang),
  }));

  const totalDeductions = deductionRows.reduce((a, r) => a + r.amount, 0);
  const net = gross - totalDeductions;

  if (base <= 0) {
    return (
      <div className="rounded-md border border-dashed px-3 py-2.5
        text-[13px] text-[var(--text-muted)]">
        {t('salary.fillFields')}
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-[var(--bg-subtle)] px-3 py-2.5">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide
          text-[var(--text-muted)]">
          {t('salary.preview')}
        </span>
        <span className="text-[11px] text-[var(--text-faint)]">
          {t(`payroll.baseType.${effectiveType}`)}
        </span>
      </div>

      <dl className="space-y-1 text-[13px]">
        <Line label={t('salary.base')} hint={formula}
              value={money(base, lang)} />

        {deductionRows.map((d) => (
          <Line key={d.name} label={d.name} hint={d.label}
                value={`− ${money(d.amount, lang)}`} negative />
        ))}

        <div className="!mt-2 flex items-baseline justify-between border-t pt-2">
          <dt className="font-medium">{t('salary.net')}</dt>
          <dd className="num text-base font-semibold">{money(net, lang)}</dd>
        </div>
      </dl>

      {allowanceRows.length > 0 && (
        <p className="mt-2 border-t pt-2 text-[12px] text-[var(--text-muted)]">
          {t('salary.plusAllowances')}:{' '}
          {allowanceRows.map((a) => `${a.name} (${a.label})`).join(', ')}
        </p>
      )}

      <p className="mt-1.5 text-[11px] text-[var(--text-faint)]">
        {t('salary.estimateNote')}
      </p>
    </div>
  );
}

function Line({ label, hint, value, negative }: {
  label: string;
  hint?: string;
  value: string;
  negative?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[var(--text-muted)]">
        {label}
        {hint && (
          <span className="num ml-1.5 text-[11px] text-[var(--text-faint)]">
            {hint}
          </span>
        )}
      </dt>
      <dd className={`num shrink-0 ${negative ? 'text-[var(--danger)]' : ''}`}>
        {value}
      </dd>
    </div>
  );
}
