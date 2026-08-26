// =====================================================================
//  To'lov usuli tanlagich.
//
//  NEGA RO'YXAT EMAS, TUGMA: kassada odam turadi va kassir sekundlar
//  ichida tanlashi kerak. Ochiladigan ro'yxat ikki bosish — tugmalar
//  bitta. Usullar oltitadan oshmaydi, shuning uchun hammasi ko'rinadi.
//
//  NEGA UMUMAN KERAK: `channel` (kassa / bank / chek) pul QAYSI YO'L
//  bilan kelganini bildiradi. Buxgalterga esa boshqa savolga javob
//  kerak — pul NAQDMI yoki kartadanmi. Kassada plastik karta bilan
//  to'langan pul kassa yashigida emas, bank hisobida bo'ladi, va
//  ilgari kassa qoldig'i shu sababli hech qachon to'g'ri chiqmasdi.
// =====================================================================

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useT } from '@/i18n';

export type PaymentMethod = {
  id: string;
  code: string;
  name: string;
  is_cash: boolean;
};

export function usePaymentMethods() {
  return useQuery({
    queryKey: ['payment-methods'],
    // Ma'lumotnoma kamdan-kam o'zgaradi — har oynada qayta so'ralmasin.
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payment_methods')
        .select('id, code, name, is_cash')
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('sort_order');
      if (error) throw error;
      return (data ?? []) as PaymentMethod[];
    },
  });
}

/** Kod bo'yicha standart tanlov — odatda naqd. */
export function defaultMethodId(list: PaymentMethod[] | undefined) {
  if (!list?.length) return '';
  return (list.find((m) => m.code === 'cash') ?? list[0]).id;
}

export function PaymentMethodPicker({
  value, onChange, disabled,
}: {
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const list = usePaymentMethods();
  const methods = list.data ?? [];

  if (list.isLoading) {
    return (
      <div className="h-9 animate-pulse rounded-md bg-[var(--bg-inset)]" />
    );
  }

  if (methods.length === 0) {
    return (
      <p className="text-[13px] text-[var(--text-muted)]">
        {t('payMethod.empty')}
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {methods.map((m) => {
        const active = m.id === value;
        return (
          <button
            key={m.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(m.id)}
            aria-pressed={active}
            className={`rounded-md border px-2.5 py-1.5 text-[13px] transition-colors
              disabled:opacity-50
              ${active
                ? 'border-[var(--sel-border)] bg-[var(--sel-bg)] text-[var(--sel-text)] font-medium'
                : 'border-[var(--border)] hover:bg-[var(--bg-subtle)]'}`}
          >
            {m.name}
          </button>
        );
      })}
    </div>
  );
}
