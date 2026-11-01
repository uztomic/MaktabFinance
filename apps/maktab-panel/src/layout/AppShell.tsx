// =====================================================================
//  Ilova qobig'i: yon panel, yuqori panel, kontent.
//
//  Menyu HUQUQ bo'yicha filtrlanadi — foydalanuvchi kira olmaydigan
//  bo'lim umuman ko'rinmaydi. Bu qulaylik uchun; haqiqiy himoya
//  bazadagi RLS da (TZ 5.4.3).
//
//  O'qituvchi va navbatchi telefondan kiradi, shuning uchun yon panel
//  mobil ekranda pastdagi navigatsiyaga aylanadi.
// =====================================================================

import { Fragment, type ReactNode, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { SubscriptionBanner } from '@/layout/SubscriptionBanner';
import { useT } from '@/i18n';
import { BranchSwitcher, LangSwitcher, ThemeToggle } from './Controls';
import { Badge } from '@/ui';
import { CommandPalette } from '@/ui/CommandPalette';
import { IdleGuard } from '@/auth/IdleGuard';
import { QuickPayHost } from '@/features/QuickPay';
import { openQuickPay } from '@/lib/quickPayBus';

interface NavItem {
  to: string;
  labelKey: string;
  /** Ko'rinishi uchun kerakli huquq. null — hammaga ochiq. */
  permission: string | null;
  icon: ReactNode;
}

interface NavGroup {
  labelKey: string;
  items: NavItem[];
}

/* Ikonkalar — tashqi kutubxonasiz, 16px chiziqli. */
const I = {
  home: <path d="M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5" />,
  users: <path d="M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20M9.5 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM21 20v-1.5a4 4 0 0 0-3-3.87M16.5 3.6a4 4 0 0 1 0 7.75" />,
  doc: <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5ZM14 3v5h5M9 13h6M9 17h6" />,
  cash: <path d="M3 7h18v10H3zM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />,
  calendar: <path d="M4 5h16v16H4zM4 10h16M9 3v4M15 3v4" />,
  chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  teacher: <path d="M12 3 2 8l10 5 10-5-10-5ZM6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5" />,
  wallet: <path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7ZM16 12h3" />,
  branch: <path d="M6 3v6a3 3 0 0 0 3 3h6a3 3 0 0 1 3 3v6M6 3H3m3 0h3M18 21h-3m3 0h3" />,
  shield: <path d="M12 3 4 6v6c0 4.5 3.2 8.4 8 9 4.8-.6 8-4.5 8-9V6l-8-3Z" />,
  gear: <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />,
  grid: <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />,
  inbox: <path d="M3 12h5l2 3h4l2-3h5M3 12V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6M3 12v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6" />,
};

function Icon({ d }: { d: ReactNode }) {
  return (
    <svg
      width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.75"
      strokeLinecap="round" strokeLinejoin="round"
      className="shrink-0"
      aria-hidden="true"
    >
      {d}
    </svg>
  );
}

const GROUPS: NavGroup[] = [
  {
    labelKey: '',
    items: [
      { to: '/', labelKey: 'nav.dashboard', permission: null, icon: <Icon d={I.home} /> },
    ],
  },
  {
    labelKey: 'nav.groupPeople',
    items: [
      { to: '/oquvchilar', labelKey: 'nav.students', permission: 'students.manage', icon: <Icon d={I.users} /> },
      { to: '/sinflar', labelKey: 'nav.classes', permission: 'students.manage', icon: <Icon d={I.grid} /> },
      { to: '/xizmatlar', labelKey: 'nav.services', permission: 'services.manage', icon: <Icon d={I.doc} /> },
      { to: '/davomat', labelKey: 'nav.attendance', permission: null, icon: <Icon d={I.calendar} /> },
      { to: '/yoqlik', labelKey: 'nav.absences', permission: 'absences.mark', icon: <Icon d={I.calendar} /> },
      { to: '/murojaatlar', labelKey: 'nav.leads', permission: 'leads.manage', icon: <Icon d={I.inbox} /> },
    ],
  },
  {
    labelKey: 'nav.groupFinance',
    items: [
      { to: '/hisoblanma', labelKey: 'nav.invoices', permission: 'invoices.generate', icon: <Icon d={I.doc} /> },
      { to: '/tolovlar', labelKey: 'nav.payments', permission: 'payments.create', icon: <Icon d={I.cash} /> },
      { to: '/qarzdorlik', labelKey: 'nav.debts', permission: 'reports.view', icon: <Icon d={I.wallet} /> },
      { to: '/xarajatlar', labelKey: 'nav.expenses', permission: 'expenses.create', icon: <Icon d={I.wallet} /> },
      { to: '/hisobotlar', labelKey: 'nav.reports', permission: 'reports.view', icon: <Icon d={I.chart} /> },
    ],
  },
  {
    labelKey: 'nav.groupStaff',
    items: [
      { to: '/oqituvchilar', labelKey: 'nav.teachers', permission: 'teachers.manage', icon: <Icon d={I.teacher} /> },
      { to: '/oylik', labelKey: 'nav.payroll', permission: 'payroll.view', icon: <Icon d={I.cash} /> },
    ],
  },
  {
    labelKey: 'nav.groupAdmin',
    items: [
      { to: '/filiallar', labelKey: 'nav.branches', permission: 'users.manage', icon: <Icon d={I.branch} /> },
      { to: '/foydalanuvchilar', labelKey: 'nav.users', permission: 'users.manage', icon: <Icon d={I.users} /> },
      { to: '/xabarlar', labelKey: 'msg.title', permission: 'reports.view', icon: <Icon d={I.inbox} /> },
      { to: '/jurnal', labelKey: 'nav.audit', permission: 'reports.view', icon: <Icon d={I.shield} /> },
      { to: '/sozlamalar', labelKey: 'nav.settings', permission: 'users.manage', icon: <Icon d={I.gear} /> },
    ],
  },
  {
    // Ijrochi bilan bog'liq bo'lim. Alohida guruh — chunki bu maktab
    // ichidagi ish emas, tashqi munosabat: obuna to'lovi va yordam.
    labelKey: 'nav.groupService',
    items: [
      { to: '/obuna', labelKey: 'nav.subscription', permission: 'users.manage', icon: <Icon d={I.wallet} /> },
      { to: '/yordam', labelKey: 'nav.help', permission: null, icon: <Icon d={I.inbox} /> },
    ],
  },
];

/** O'qituvchi uchun alohida, qisqa menyu (PWA, telefon). */
const TEACHER_NAV: NavItem[] = [
  { to: '/', labelKey: 'nav.dashboard', permission: null, icon: <Icon d={I.home} /> },
  { to: '/davomat', labelKey: 'nav.myAttendance', permission: null, icon: <Icon d={I.calendar} /> },
  { to: '/yuklamam', labelKey: 'nav.myLoad', permission: null, icon: <Icon d={I.teacher} /> },
  { to: '/oyligim', labelKey: 'nav.myPayroll', permission: null, icon: <Icon d={I.cash} /> },
];

/** Telefon pastki paneli uchun ustuvorlik tartibi. */
const BOTTOM_PRIORITY = ['/', '/oquvchilar', '/tolovlar', '/qarzdorlik', '/davomat', '/oylik', '/hisobotlar'];

/** Pastki panelda sig'adigan qisqa nomlar. */
const SHORT: Record<string, string> = { '/': 'nav.home' };

export default function AppShell() {
  const t = useT();
  const { profile, can, mayWrite, permissions, signOut, impersonation } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  /**
   *  Qisqa menyu — faqat ODDIY o'qituvchiga.
   *
   *  Rolga qo'shimcha huquq berilgan bo'lsa (masalan navbatchilik
   *  uchun davomat yoki o'quvchi qo'shish), qisqa menyu o'sha
   *  bo'limlarni ko'rsatmasdi va berilgan ruxsat amalda ishlamasdi.
   */
  const isTeacher = profile?.role === 'teacher' && permissions.size === 0;

  const groups: NavGroup[] = isTeacher
    ? [{ labelKey: '', items: TEACHER_NAV }]
    : GROUPS
      .map((g) => ({
        ...g,
        items: g.items.filter((i) => i.permission === null || can(i.permission)),
      }))
      .filter((g) => g.items.length > 0);

  //  Pastki panel: rolga qarab eng kerakli bo'limlar. Kassir/buxgalterda
  //  o'rtada "+ To'lov" — eng ko'p bajariladigan ish bitta bosishda.
  const canPay = !isTeacher && mayWrite('payments.create');
  const flat = groups.flatMap((g) => g.items);
  const bottomItems = isTeacher
    ? TEACHER_NAV.slice(0, 4)
    : BOTTOM_PRIORITY
      .map((to) => flat.find((i) => i.to === to))
      .filter((i): i is NavItem => !!i)
      .filter((i) => !(canPay && i.to === '/tolovlar'))
      .slice(0, canPay ? 3 : 4);

  const payButton = (
    <button onClick={() => openQuickPay()} aria-label={t('quickpay.title')}
      className="flex min-h-14 flex-col items-center justify-center">
      <span className="-mt-5 flex h-12 w-12 items-center justify-center rounded-full bg-brand-700
        text-2xl leading-none text-white shadow-lg shadow-black/25 ring-4 ring-[var(--bg)] active:scale-95">+</span>
      <span className="mt-0.5 text-[10.5px] font-semibold text-[var(--text)]">{t('quickpay.short')}</span>
    </button>
  );

  const openSearch = () => {
    // Palitraning o'zi Ctrl+K ni tinglaydi — bitta manba.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
  };

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${
      isActive
        ? 'bg-brand-800 font-medium text-white'
        : 'text-brand-200 hover:bg-brand-800/60 hover:text-white'
    }`;

  return (
    /*  Qobiq balandligi QAT'IY va faqat ichki qism suriladi.
        Ilgari butun sahifa surilardi va sarlavha `sticky` bilan
        ushlab turilardi. Mobil brauzerda bu ishlamasdi: `html` va
        `body` ga `height: 100%` berilgani uchun surish konteyneri
        chalkashib qolardi va sarlavha yuqoriga chiqib ketardi —
        pastga tushgandan keyin menyu tugmasiga umuman yetib
        bo'lmasdi.

        `dvh` — mobil brauzerdagi manzil satri yig'ilganda ham
        to'g'ri balandlik. `vh` bunday paytda ekrandan kattaroq
        chiqadi va pastda kesilib qoladi.

        Chop etishda cheklovlar olib tashlanadi (`print:`), aks holda
        faqat birinchi ekran bosiladi.  */
    <div className="flex h-[100dvh] flex-col overflow-hidden
      print:h-auto print:overflow-visible">
      {/* --- Obuna muddati ogohlantirishi (TZ P3) ------------------
          Har sahifada ko'rinadi va muddatga qarab rangi o'zgaradi.
          Faqat direktorga — boshqalar to'lay olmaydi. */}
      <SubscriptionBanner />

      {/* --- Texnik yordam banneri (TZ 4.13.5.3) ------------------- */}
      {impersonation && (
        <div
          className="no-print flex flex-wrap items-center justify-center gap-2
            bg-[var(--warn-bg)] px-4 py-1.5 text-center text-[13px]
            font-medium text-[var(--warn)]"
          role="alert"
        >
          <span>
            {t('impersonation.banner', { school: profile?.school_name ?? '' })}
          </span>
          <Badge tone={impersonation.mode === 'write' ? 'danger' : 'neutral'}>
            {impersonation.mode === 'write'
              ? t('impersonation.write')
              : t('impersonation.readonly')}
          </Badge>
          <span className="opacity-80">{t('impersonation.logged')}</span>
        </div>
      )}

      <div className="flex min-h-0 flex-1 print:min-h-0 print:overflow-visible">
        {/* --- Yon panel (katta ekran) --------------------------- */}
        {/*  Yon panel sahifa bilan BIRGA surilmaydi: uning o'z
             surish qismi bor (`nav` ichida). Ilgari u qatorning
             bir qismi edi va uzun ro'yxatda sahifa bilan birga
             ko'tarilib ketardi. */}
        <aside
          className="no-print hidden h-full w-56 shrink-0 flex-col
            overflow-hidden bg-brand-900 md:flex"
        >
          <div className="flex items-center gap-2 px-4 py-4">
            <img src="/logo-mark.svg" alt="" className="h-7 w-7" width={28} height={28} />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold leading-tight text-white">
                Maktab<span className="text-accent-400">Finance</span>
              </div>
              <div className="truncate text-[11px] leading-tight text-brand-300">
                {profile?.school_name}
              </div>
            </div>
          </div>

          <nav className="flex-1 space-y-4 overflow-y-auto px-2 pb-4">
            {groups.map((g, gi) => (
              <div key={g.labelKey || gi}>
                {g.labelKey && (
                  <div className="px-2.5 pb-1 text-[10px] font-semibold uppercase
                    tracking-wider text-brand-400">
                    {t(g.labelKey)}
                  </div>
                )}
                <div className="space-y-0.5">
                  {g.items.map((item) => (
                    <NavLink key={item.to} to={item.to} end={item.to === '/'}
                             className={linkClass}>
                      {item.icon}
                      <span className="truncate">{t(item.labelKey)}</span>
                    </NavLink>
                  ))}
                </div>
              </div>
            ))}
          </nav>

          <div className="border-t border-brand-800 px-3 py-3">
            <div className="truncate text-[13px] font-medium text-white">
              {profile?.full_name}
            </div>
            <div className="text-[11px] text-brand-300">
              {profile && t(`role.${profile.role}`)}
            </div>
            <button
              onClick={signOut}
              className="mt-2 text-[12px] text-brand-300 hover:text-white hover:underline"
            >
              {t('auth.logout')}
            </button>
          </div>
        </aside>

        {/* --- Asosiy qism ---------------------------------------- */}
        <div className="flex min-w-0 min-h-0 flex-1 flex-col">
          {/*  `sticky` olib tashlandi: sarlavha endi surilmaydigan
               qismda turadi va har doim ko'rinadi. */}
          <header className="no-print z-20 flex shrink-0 items-center gap-2
            border-b bg-[var(--bg)] px-3 py-2 md:px-5">
            <div className="flex items-center gap-2 md:hidden">
              <img src="/logo-mark.svg" alt="" className="h-6 w-6" />
              <span className="text-sm font-semibold">MaktabFinance</span>
            </div>

            <button
              onClick={openSearch}
              className="ml-2 hidden items-center gap-2 rounded-md border px-2.5
                py-1.5 text-[13px] text-[var(--text-muted)]
                hover:bg-[var(--bg-subtle)] sm:flex"
              title={t('search.placeholder')}
            >
              <span>⌕</span>
              <span>{t('search.short')}</span>
              <kbd className="rounded border px-1 py-0.5 text-[10px]">Ctrl K</kbd>
            </button>

            <div className="ml-auto flex items-center gap-2">
              {/* Telefonda qidiruv — ikonka (Ctrl K yo'q). */}
              <button
                onClick={openSearch}
                className="flex h-9 w-9 items-center justify-center rounded-md border sm:hidden"
                aria-label={t('search.short')}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              </button>
              <BranchSwitcher />
              <span className="hidden sm:block"><LangSwitcher /></span>
              <ThemeToggle />
            </div>
          </header>

          {/* Mobil menyu — pastdan chiqadigan to'liq varaq. */}
          {menuOpen && (
            <div className="no-print fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true">
              <button className="absolute inset-0 bg-black/50" aria-label={t('common.close')}
                      onClick={() => setMenuOpen(false)} />
              <nav className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl
                bg-brand-900 px-3 pb-[calc(16px+env(safe-area-inset-bottom))] pt-2 shadow-2xl">
                <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-brand-700" />
                <div className="mb-3 flex items-center justify-between gap-3 px-1">
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-semibold text-white">{profile?.full_name}</div>
                    <div className="truncate text-[12px] text-brand-300">
                      {profile && t(`role.${profile.role}`)} · {profile?.school_name}
                    </div>
                  </div>
                  <LangSwitcher />
                </div>
                {groups.map((g, gi) => (
                  <div key={g.labelKey || gi} className="mb-3 last:mb-0">
                    {g.labelKey && (
                      <div className="px-1 pb-1.5 text-[10px] font-semibold uppercase
                        tracking-wider text-brand-400">
                        {t(g.labelKey)}
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-1.5">
                      {g.items.map((item) => (
                        <NavLink
                          key={item.to} to={item.to} end={item.to === '/'}
                          onClick={() => setMenuOpen(false)}
                          className={({ isActive }) => `flex min-h-11 items-center gap-2 rounded-lg px-3
                            text-[13px] ${isActive ? 'bg-brand-700 font-medium text-white'
                              : 'bg-brand-800/60 text-brand-100 active:bg-brand-800'}`}
                        >
                          {item.icon}
                          <span className="truncate">{t(item.labelKey)}</span>
                        </NavLink>
                      ))}
                    </div>
                  </div>
                ))}
                <button onClick={signOut}
                        className="mt-2 flex min-h-11 w-full items-center justify-center rounded-lg
                          border border-brand-700 text-[13px] text-brand-200">
                  {t('auth.logout')}
                </button>
              </nav>
            </div>
          )}

          <main className="flex-1 overflow-y-auto px-3 pb-6 pt-4 md:px-5 md:py-5
            print:overflow-visible">
            <Outlet />
          </main>

          {/* --- Pastki navigatsiya (telefon) ------------------------
               Eng ko'p ishlatiladigan 4 bo'lim + "Menyu". Ilgari
               telefonda har bir o'tish uchun yuqoridagi menyuni ochib,
               22 bandli ro'yxatdan qidirish kerak edi. */}
          <nav className="no-print grid shrink-0 grid-cols-5 border-t bg-[var(--bg)]
            pb-[env(safe-area-inset-bottom)] md:hidden">
            {bottomItems.map((item, i) => (
              <Fragment key={item.to}>
                {canPay && i === 2 && payButton}
                <NavLink to={item.to} end={item.to === '/'}
                  className={({ isActive }) => `flex min-h-14 flex-col items-center justify-center gap-0.5
                    px-1 text-[10.5px] leading-tight ${isActive ? 'font-semibold text-brand-600 dark:text-accent-400'
                      : 'text-[var(--text-muted)]'}`}>
                  {item.icon}
                  <span className="max-w-full truncate">{t(SHORT[item.to] ?? item.labelKey)}</span>
                </NavLink>
              </Fragment>
            ))}
            {canPay && bottomItems.length < 3 && payButton}
            <button onClick={() => setMenuOpen(true)}
              className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-[10.5px]
                text-[var(--text-muted)]">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
              <span>{t('nav.menu')}</span>
            </button>
          </nav>

          <CommandPalette />
          <QuickPayHost />
          <IdleGuard />
        </div>
      </div>
    </div>
  );
}
