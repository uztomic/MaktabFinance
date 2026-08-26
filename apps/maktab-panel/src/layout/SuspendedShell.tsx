// =====================================================================
//  Bloklangan maktab qobig'i (TZ P2).
//
//  MUAMMO: to'lov 45 kundan ortiq kechikkanda maktab `restricted`
//  holatiga o'tadi va tizimga kira olmaydi. Oddiy panelni ko'rsatish
//  noto'g'ri bo'lardi — menyu, hisobotlar, o'quvchilar ochiladi,
//  lekin hech narsa yozib bo'lmaydi va sababi ham tushunarsiz.
//
//  YECHIM: alohida, sodda ekran. TZ P2 ro'yxati:
//    · qarzdorlik summasi va necha kundan beri
//    · to'lov rekvizitlari
//    · chek yuklash tugmasi
//    · super admin bilan muloqot
//  "Boshqa hech narsa ochilmaydi."
//
//  NEGA BU RLS DA EMAS (TZ 2.4): bazani yopib qo'ysak direktor
//  to'lov ekranini ham ko'ra olmaydi va tizim boshi berk ko'chaga
//  kiradi. Baza o'qishga ochiq qoladi, kirishni `App.tsx` to'sadi.
//
//  Uchta narsa aniq aytiladi: NIMA bo'ldi, ma'lumot YO'QOLMADI,
//  NIMA QILISH kerak. Uchalasi ham ekranning tepasida.
// =====================================================================

import { Suspense, lazy, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n, useT } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { money } from '@/lib/format';
import { LangSwitcher, ThemeToggle } from '@/layout/Controls';
import { Button, Card, Loading, Notice } from '@/ui';

const Subscription = lazy(() => import('@/features/Subscription'));
const SupportChat = lazy(() => import('@/features/SupportChat'));

export default function SuspendedShell() {
  const t = useT();
  const { lang } = useI18n();
  const { profile, signOut } = useAuth();
  const [tab, setTab] = useState<'sub' | 'help'>('sub');

  //  Qarzdorlik va kechikish — TZ P2 ning birinchi bandi. Direktor
  //  "qancha va qachondan beri" degan savolga darhol javob olsin.
  const debt = useQuery({
    queryKey: ['blocked-debt', profile?.school_id],
    enabled: !!profile?.school_id,
    queryFn: async () => {
      const [inv, sub] = await Promise.all([
        supabase.from('subscription_invoices')
          .select('total_amount, paid_amount, status')
          .in('status', ['unpaid', 'partial']),
        supabase.from('school_subscriptions')
          .select('next_payment_date')
          .neq('status', 'cancelled')
          .maybeSingle(),
      ]);
      if (inv.error) throw inv.error;

      const amount = (inv.data ?? []).reduce(
        (s, i) => s + (Number(i.total_amount) - Number(i.paid_amount)), 0);

      const due = sub.data?.next_payment_date as string | undefined;
      const days = due
        ? Math.floor((Date.now() - new Date(due).getTime()) / 86400000)
        : null;

      return { amount, days };
    },
  });

  //  Rekvizitlar `platform_settings` da, `is_public = true` —
  //  bloklangan maktab ham o'qiy oladi.
  const requisites = useQuery({
    queryKey: ['payment-requisites'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('platform_settings')
        .select('value')
        .eq('key', 'billing.requisites')
        .maybeSingle();
      if (error) throw error;
      return (data?.value as string | null) ?? null;
    },
  });

  return (
    <div className="flex min-h-full flex-col bg-[var(--bg-subtle)]">
      <header className="flex items-center gap-2 border-b bg-[var(--bg)] px-3 py-2 md:px-5">
        <div>
          <p className="text-sm font-semibold">{profile?.school_name}</p>
          <p className="text-[11px] text-[var(--text-muted)]">{t('app.name')}</p>
        </div>
        <div className="flex-1" />
        <LangSwitcher />
        <ThemeToggle />
        <Button size="sm" onClick={signOut}>{t('auth.logout')}</Button>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-3 py-4 md:px-5">
        {/* --- Eng muhim xabar. Birinchi ko'rinadigan joyda. -------- */}
        <div className="mb-4 rounded-lg border border-[var(--danger)]
          bg-[var(--danger-bg)] p-4">
          <h1 className="text-base font-semibold text-[var(--danger)]">
            {t('blocked.title')}
          </h1>
          <p className="mt-1.5 text-[13px] text-[var(--text)]">
            {t('blocked.message')}
          </p>

          {/* --- Qarzdorlik: summa va kun (TZ P2) ------------------- */}
          {debt.data && (
            <div className="mt-3 flex flex-wrap gap-4 rounded-md
              bg-[var(--bg)] px-3 py-2">
              <div>
                <p className="text-[11px] uppercase tracking-wide
                  text-[var(--text-muted)]">{t('blocked.debt')}</p>
                <p className="num text-lg font-semibold text-[var(--danger)]">
                  {money(debt.data.amount, lang)}
                </p>
              </div>
              {debt.data.days !== null && debt.data.days >= 0 && (
                <div>
                  <p className="text-[11px] uppercase tracking-wide
                    text-[var(--text-muted)]">{t('blocked.overdue')}</p>
                  <p className="num text-lg font-semibold text-[var(--danger)]">
                    {t('blocked.days', { days: String(debt.data.days) })}
                  </p>
                </div>
              )}
            </div>
          )}

          <p className="mt-3 text-[13px] font-medium text-[var(--text)]">
            {t('blocked.dataSafe')}
          </p>
          <p className="mt-2 text-[13px] text-[var(--text-muted)]">
            {t('blocked.whatToDo')}
          </p>
        </div>

        {/* --- To'lov rekvizitlari (TZ P2) ------------------------- */}
        {requisites.data && (
          <Card title={t('blocked.requisites')} className="mb-4">
            <pre className="whitespace-pre-wrap font-sans text-[13px]
              text-[var(--text)]">{requisites.data}</pre>
          </Card>
        )}

        <div className="mb-3 flex gap-1.5">
          <button
            onClick={() => setTab('sub')}
            className={`rounded-md px-3 py-1.5 text-[13px] ${
              tab === 'sub'
                ? 'bg-brand-900 font-medium text-white'
                : 'border bg-[var(--bg)] hover:bg-[var(--bg-inset)]'
            }`}
          >
            {t('nav.subscription')}
          </button>
          <button
            onClick={() => setTab('help')}
            className={`rounded-md px-3 py-1.5 text-[13px] ${
              tab === 'help'
                ? 'bg-brand-900 font-medium text-white'
                : 'border bg-[var(--bg)] hover:bg-[var(--bg-inset)]'
            }`}
          >
            {t('nav.help')}
          </button>
        </div>

        <Suspense fallback={<Loading />}>
          {tab === 'sub' ? <Subscription /> : <SupportChat />}
        </Suspense>

        <div className="mt-4">
          <Notice tone="brand">{t('blocked.afterPayment')}</Notice>
        </div>
      </main>
    </div>
  );
}
