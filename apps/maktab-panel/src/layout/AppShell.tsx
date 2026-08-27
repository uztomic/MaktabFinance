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

import { type ReactNode, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { SubscriptionBanner } from '@/layout/SubscriptionBanner';
import { useT } from '@/i18n';
import { BranchSwitcher, LangSwitcher, ThemeToggle } from './Controls';
import { Badge, Button } from '@/ui';
import { CommandPalette } from '@/ui/CommandPalette';
import { IdleGuard } from '@/auth/IdleGuard';

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

export default function AppShell() {
  const t = useT();
  const { profile, can, signOut, impersonation } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const isTeacher = profile?.role === 'teacher';

  const groups: NavGroup[] = isTeacher
    ? [{ labelKey: '', items: TEACHER_NAV }]
    : GROUPS
      .map((g) => ({
        ...g,
        items: g.items.filter((i) => i.permission === null || can(i.permission)),
      }))
      .filter((g) => g.items.length > 0);

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${
      isActive
        ? 'bg-brand-800 font-medium text-white'
        : 'text-brand-200 hover:bg-brand-800/60 hover:text-white'
    }`;

  return (
    <div className="flex min-h-screen flex-col">
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

      <div className="flex flex-1">
        {/* --- Yon panel (katta ekran) --------------------------- */}
        <aside
          className="no-print hidden w-56 shrink-0 flex-col bg-brand-900 md:flex"
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
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="no-print sticky top-0 z-20 flex items-center gap-2
            border-b bg-[var(--bg)] px-3 py-2 md:px-5">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="flex h-9 w-9 items-center justify-center rounded-md border
                md:hidden"
              aria-label="menu"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>

            <div className="flex items-center gap-2 md:hidden">
              <img src="/logo-mark.svg" alt="" className="h-6 w-6" />
              <span className="text-sm font-semibold">MaktabFinance</span>
            </div>

            <button
              onClick={() => {
                // Palitraning o'zi Ctrl+K ni tinglaydi — shu hodisani
                // sintetik tarzda yuborish ortiqcha holat saqlashdan
                // ko'ra sodda va bitta manbani saqlab qoladi.
                document.dispatchEvent(new KeyboardEvent('keydown', {
                  key: 'k', ctrlKey: true, bubbles: true,
                }));
              }}
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
              <BranchSwitcher />
              <LangSwitcher />
              <ThemeToggle />
            </div>
          </header>

          {/* Mobil menyu */}
          {menuOpen && (
            <nav className="no-print border-b bg-brand-900 px-2 py-3 md:hidden">
              {groups.map((g, gi) => (
                <div key={g.labelKey || gi} className="mb-3 last:mb-0">
                  {g.labelKey && (
                    <div className="px-2.5 pb-1 text-[10px] font-semibold uppercase
                      tracking-wider text-brand-400">
                      {t(g.labelKey)}
                    </div>
                  )}
                  {g.items.map((item) => (
                    <NavLink
                      key={item.to} to={item.to} end={item.to === '/'}
                      className={linkClass}
                      onClick={() => setMenuOpen(false)}
                    >
                      {item.icon}
                      {t(item.labelKey)}
                    </NavLink>
                  ))}
                </div>
              ))}
              <div className="mt-3 border-t border-brand-800 px-2.5 pt-3">
                <div className="text-[13px] text-white">{profile?.full_name}</div>
                <Button size="sm" variant="ghost" onClick={signOut}
                        className="mt-1 !text-brand-300">
                  {t('auth.logout')}
                </Button>
              </div>
            </nav>
          )}

          <main className="flex-1 px-3 py-4 md:px-5 md:py-5">
            <Outlet />
          </main>

          <CommandPalette />
          <IdleGuard />
        </div>
      </div>
    </div>
  );
}
