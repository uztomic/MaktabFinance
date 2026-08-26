// =====================================================================
//  Obuna muddati ogohlantirishi (TZ P3).
//
//  MUAMMO: to'lov muddati jimgina o'tib ketardi. Direktor buni faqat
//  45-kuni, tizim bloklanganda bilardi — va o'shanda kech bo'lardi.
//
//  YECHIM: HAR SAHIFADA ko'rinadigan chiziq. Rang muddatga qarab
//  o'zgaradi (TZ P3):
//
//    15 kun qoldi  → kulrang, sokin eslatma
//     5 kun qoldi  → sariq, e'tibor tortadi
//    muddat o'tdi  → qizil, kun soni bilan
//
//  NEGA MENYUDA EMAS, CHIZIQDA: menyu elementi ko'rilmay qoladi —
//  odam har kuni o'sha yerni ko'rib, o'qimay qo'yadi. Sahifa
//  tepasidagi rangli chiziq esa har safar ko'zga tashlanadi.
//
//  KIM KO'RADI: faqat `users.manage` huquqi borlar, ya'ni direktor.
//  Buxgalter yoki o'qituvchiga obuna to'lovi haqida xabar berish
//  foydasiz — u to'lay olmaydi va faqat xavotir uyg'otadi.
// =====================================================================

import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n, useT } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { date } from '@/lib/format';

/** Nechanchi kundan boshlab ogohlantirish ko'rinadi. */
const NOTICE_FROM = 15;
/** Nechanchi kundan boshlab sariq bo'ladi. */
const WARN_FROM = 5;

export function SubscriptionBanner() {
  const t = useT();
  const { lang } = useI18n();
  const { can, profile } = useAuth();

  const sub = useQuery({
    queryKey: ['subscription-banner', profile?.school_id],
    enabled: !!profile?.school_id && can('users.manage'),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('school_subscriptions')
        .select('status, next_payment_date, trial_ends_at')
        .neq('status', 'cancelled')
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    // Kuniga bir marta o'zgaradigan ma'lumot — tez-tez so'rash shart emas.
    staleTime: 10 * 60 * 1000,
  });

  if (!can('users.manage') || !sub.data) return null;

  //  Sinov muddatida boshqa sana muhim: to'lov emas, sinov tugashi.
  const isTrial = sub.data.status === 'trial' && sub.data.trial_ends_at;
  const target = (isTrial ? sub.data.trial_ends_at : sub.data.next_payment_date) as
    string | null;
  if (!target) return null;

  const days = Math.floor(
    (new Date(target).getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000);

  // Muddatga hali ko'p bor — chiziq umuman chiqmaydi.
  if (days > NOTICE_FROM) return null;

  const overdue = days < 0;
  const tone = overdue
    ? 'bg-[var(--danger-bg)] text-[var(--danger)]'
    : days <= WARN_FROM
      ? 'bg-[var(--warn-bg)] text-[var(--warn)]'
      : 'bg-[var(--bg-inset)] text-[var(--text-muted)]';

  const text = overdue
    ? t('subBanner.overdue', { days: String(-days) })
    : isTrial
      ? t('subBanner.trial', { days: String(days), date: date(target, lang) })
      : t('subBanner.due', { days: String(days), date: date(target, lang) });

  return (
    <div className={`no-print flex flex-wrap items-center justify-center gap-2
      px-4 py-1.5 text-center text-[13px] font-medium ${tone}`} role="status">
      <span>{text}</span>
      <Link to="/obuna" className="underline underline-offset-2">
        {t('subBanner.action')}
      </Link>
    </div>
  );
}
