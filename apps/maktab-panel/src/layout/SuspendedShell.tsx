// =====================================================================
//  To'xtatilgan maktab qobig'i.
//
//  MUAMMO: to'lov 45 kundan ortiq kechikkanda baza maktab ma'lumotini
//  umuman qaytarmaydi (migratsiya 41). Oddiy panel bunday holatda
//  bo'sh jadvallar va "ma'lumot yo'q" yozuvlarini ko'rsatardi —
//  direktor esa nima bo'lganini tushunmasdi va "tizim buzildi" deb
//  o'ylardi.
//
//  YECHIM: alohida, sodda qobiq. Uchta narsa aniq aytiladi:
//    1. NIMA bo'ldi — to'lov kechikdi
//    2. Ma'lumot YO'QOLMADI — hammasi joyida turibdi
//    3. NIMA QILISH kerak — chek yuborish yoki yozish
//
//  Boshqa hech qanday sahifa ochilmaydi: menyu ham yo'q, chunki
//  ochilsa ham bo'sh bo'lardi.
// =====================================================================

import { Suspense, lazy, useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { useT } from '@/i18n';
import { LangSwitcher, ThemeToggle } from '@/layout/Controls';
import { Button, Loading, Notice } from '@/ui';

const Subscription = lazy(() => import('@/features/Subscription'));
const SupportChat = lazy(() => import('@/features/SupportChat'));

export default function SuspendedShell() {
  const t = useT();
  const { profile, signOut } = useAuth();
  const [tab, setTab] = useState<'sub' | 'help'>('sub');

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
        {/* Eng muhim xabar — birinchi ko'rinadigan joyda. */}
        <div className="mb-4 rounded-lg border border-[var(--danger)]
          bg-[var(--danger-bg)] p-4">
          <h1 className="text-base font-semibold text-[var(--danger)]">
            {t('blocked.title')}
          </h1>
          <p className="mt-1.5 text-[13px] text-[var(--text)]">
            {t('blocked.message')}
          </p>
          <p className="mt-2 text-[13px] font-medium text-[var(--text)]">
            {t('blocked.dataSafe')}
          </p>
          <p className="mt-2 text-[13px] text-[var(--text-muted)]">
            {t('blocked.whatToDo')}
          </p>
        </div>

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

        <Notice tone="brand">{t('blocked.afterPayment')}</Notice>
      </main>
    </div>
  );
}
