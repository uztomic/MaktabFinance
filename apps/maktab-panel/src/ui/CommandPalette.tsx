// =====================================================================
//  Global qidiruv — Ctrl+K.
//
//  Nega kerak: o'quvchini topish uchun "O'quvchilar" sahifasiga o'tib,
//  qidiruv maydonini topib, yozish kerak edi. Kassada navbat turganda
//  bu uzoq. Endi istalgan sahifada Ctrl+K bosiladi.
//
//  Nima qidiriladi:
//    · o'quvchi — ismi yoki TO'LOV KODI bo'yicha
//    · kvitansiya raqami — kassa cheki qo'lda bo'lsa
//    · sinf, o'qituvchi
//    · sahifalar — "hisobot" deb yozib hisobotlarga o'tish
//
//  Qidiruv 250 ms kechikish bilan yuboriladi: har harfda so'rov
//  jo'natish bazani ham, tarmoqni ham ortiqcha yuklaydi.
// =====================================================================

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useT } from '@/i18n';
import { Spinner } from './index';

interface Hit {
  id: string;
  group: string;
  title: string;
  subtitle?: string;
  to: string;
  icon: string;
}

/** Huquq talab qiladigan sahifalar — menyudagi bilan bir xil. */
const PAGES: Array<{ to: string; labelKey: string; permission: string | null }> = [
  { to: '/', labelKey: 'nav.dashboard', permission: null },
  { to: '/oquvchilar', labelKey: 'nav.students', permission: 'students.manage' },
  { to: '/sinflar', labelKey: 'nav.classes', permission: 'students.manage' },
  { to: '/xizmatlar', labelKey: 'nav.services', permission: 'services.manage' },
  { to: '/yoqlik', labelKey: 'nav.absences', permission: 'absences.mark' },
  { to: '/murojaatlar', labelKey: 'nav.leads', permission: 'leads.manage' },
  { to: '/hisoblanma', labelKey: 'nav.invoices', permission: 'invoices.generate' },
  { to: '/tolovlar', labelKey: 'nav.payments', permission: 'payments.create' },
  { to: '/qarzdorlik', labelKey: 'nav.debts', permission: 'reports.view' },
  { to: '/xarajatlar', labelKey: 'nav.expenses', permission: 'expenses.create' },
  { to: '/hisobotlar', labelKey: 'nav.reports', permission: 'reports.view' },
  { to: '/oqituvchilar', labelKey: 'nav.teachers', permission: 'teachers.manage' },
  { to: '/oylik', labelKey: 'nav.payroll', permission: 'payroll.view' },
  { to: '/filiallar', labelKey: 'nav.branches', permission: 'users.manage' },
  { to: '/foydalanuvchilar', labelKey: 'nav.users', permission: 'users.manage' },
  { to: '/xabarlar', labelKey: 'msg.title', permission: 'reports.view' },
  { to: '/jurnal', labelKey: 'nav.audit', permission: 'reports.view' },
  { to: '/sozlamalar', labelKey: 'nav.settings', permission: 'users.manage' },
];

export function CommandPalette() {
  const t = useT();
  const navigate = useNavigate();
  const { can, branchId } = useAuth();

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // --- Ctrl+K / Cmd+K --------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQ('');
      setDebounced('');
      setActive(0);
      // Modal ochilganidan keyin fokus — aks holda input hali yo'q.
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  // --- Kechikish ---------------------------------------------------
  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);

  const pageHits = useMemo<Hit[]>(() => {
    const needle = debounced.toLowerCase();
    return PAGES
      .filter((p) => p.permission === null || can(p.permission))
      .map((p) => ({
        id: `page:${p.to}`,
        group: t('search.pages'),
        title: t(p.labelKey),
        to: p.to,
        icon: '→',
      }))
      .filter((h) => !needle || h.title.toLowerCase().includes(needle));
  }, [debounced, can, t]);

  // --- Bazadan qidirish --------------------------------------------
  const search = useCallback(async (needle: string) => {
    if (needle.length < 2) { setHits([]); return; }
    setLoading(true);

    const like = `%${needle}%`;
    const out: Hit[] = [];

    try {
      // O'quvchi — ism yoki to'lov kodi.
      if (can('students.manage') || can('reports.view')) {
        let sq = supabase
          .from('students')
          .select('id, full_name, class_name, payment_code, status')
          .is('deleted_at', null)
          .or(`full_name.ilike.${like},payment_code.ilike.${like}`)
          .order('full_name')
          .limit(8);
        if (branchId) sq = sq.eq('branch_id', branchId);
        const { data } = await sq;
        for (const s of data ?? []) {
          out.push({
            id: `st:${s.id}`,
            group: t('nav.students'),
            title: s.full_name,
            subtitle: [s.class_name, s.payment_code].filter(Boolean).join(' · '),
            to: `/oquvchilar/${s.id}`,
            icon: s.status === 'active' ? '👤' : '👤',
          });
        }
      }

      // Sinf.
      if (can('students.manage')) {
        let cq = supabase
          .from('classes')
          .select('id, name, academic_year')
          .is('deleted_at', null)
          .ilike('name', like)
          .order('name')
          .limit(5);
        if (branchId) cq = cq.eq('branch_id', branchId);
        const { data } = await cq;
        for (const c of data ?? []) {
          out.push({
            id: `cl:${c.id}`,
            group: t('cls.title'),
            title: c.name,
            subtitle: c.academic_year,
            to: `/sinflar/${c.id}`,
            icon: '▦',
          });
        }
      }

      // O'qituvchi.
      if (can('teachers.manage')) {
        const { data } = await supabase
          .from('teachers')
          .select('id, full_name, phone, category')
          .is('deleted_at', null)
          .ilike('full_name', like)
          .order('full_name')
          .limit(5);
        for (const te of data ?? []) {
          out.push({
            id: `te:${te.id}`,
            group: t('nav.teachers'),
            title: te.full_name,
            subtitle: [te.category, te.phone].filter(Boolean).join(' · '),
            to: `/oqituvchilar/${te.id}`,
            icon: '🎓',
          });
        }
      }

      // Kvitansiya raqami — qo'ldagi qog'ozdan qidirish.
      if (can('payments.create')) {
        const { data } = await supabase
          .from('cash_receipts')
          .select('receipt_code, payment_id, issued_at, payments(student_id, amount, students(full_name))')
          .ilike('receipt_code', like)
          .order('issued_at', { ascending: false })
          .limit(5);
        for (const r of data ?? []) {
          // deno-lint-ignore no-explicit-any
          const pay = (r as any).payments;
          out.push({
            id: `rc:${r.receipt_code}`,
            group: t('pay.receipt'),
            title: r.receipt_code,
            subtitle: pay?.students?.full_name ?? '',
            to: pay?.student_id ? `/oquvchilar/${pay.student_id}` : '/tolovlar',
            icon: '🧾',
          });
        }
      }
    } finally {
      setLoading(false);
    }

    setHits(out);
  }, [can, branchId, t]);

  useEffect(() => {
    if (!open) return;
    search(debounced);
  }, [debounced, open, search]);

  const all = useMemo(() => [...hits, ...pageHits], [hits, pageHits]);

  useEffect(() => { setActive(0); }, [all.length]);

  function go(hit: Hit) {
    setOpen(false);
    navigate(hit.to);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(all.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (all[active]) go(all[active]);
    }
  }

  // Tanlangan qator ko'rinish maydonidan chiqib ketmasin.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  // Guruhlab chiqaramiz, lekin klaviatura indeksi umumiy ro'yxat bo'yicha.
  const groups: Array<{ name: string; items: Array<{ hit: Hit; index: number }> }> = [];
  all.forEach((hit, index) => {
    let g = groups.find((x) => x.name === hit.group);
    if (!g) { g = { name: hit.group, items: [] }; groups.push(g); }
    g.items.push({ hit, index });
  });

  return (
    <div
      className="no-print fixed inset-0 z-[90] flex items-start justify-center
        bg-black/40 px-4 pt-[10vh]"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border
          bg-[var(--bg)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b px-3">
          <span className="text-[var(--text-faint)]">⌕</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('search.placeholder')}
            className="h-12 flex-1 bg-transparent text-sm text-[var(--text)]
              outline-none placeholder:text-[var(--text-faint)]"
          />
          {loading && <Spinner />}
          <kbd className="rounded border px-1.5 py-0.5 text-[10px]
            text-[var(--text-faint)]">
            ESC
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[60vh] overflow-y-auto p-1.5">
          {all.length === 0
            ? (
              <p className="px-3 py-6 text-center text-[13px]
                text-[var(--text-muted)]">
                {debounced.length < 2
                  ? t('search.hint')
                  : t('search.nothing', { q: debounced })}
              </p>
            )
            : groups.map((g) => (
              <div key={g.name} className="mb-1 last:mb-0">
                <div className="px-2.5 pb-0.5 pt-1.5 text-[10px] font-semibold
                  uppercase tracking-wider text-[var(--text-faint)]">
                  {g.name}
                </div>
                {g.items.map(({ hit, index }) => (
                  <button
                    key={hit.id}
                    data-active={index === active}
                    onClick={() => go(hit)}
                    onMouseEnter={() => setActive(index)}
                    className={`flex w-full items-center gap-2.5 rounded-md px-2.5
                      py-1.5 text-left text-[13px] ${
                        index === active
                          ? 'bg-brand-50 text-brand-900'
                          : 'text-[var(--text)] hover:bg-[var(--bg-subtle)]'
                      }`}
                  >
                    <span className="w-4 shrink-0 text-center">{hit.icon}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {hit.title}
                    </span>
                    {hit.subtitle && (
                      <span className="shrink-0 truncate text-[12px]
                        text-[var(--text-muted)]">
                        {hit.subtitle}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ))}
        </div>

        <div className="flex items-center gap-3 border-t px-3 py-1.5
          text-[11px] text-[var(--text-faint)]">
          <Key>↑↓</Key> {t('search.navigate')}
          <Key>↵</Key> {t('search.openHint')}
          <span className="ml-auto"><Key>Ctrl</Key> + <Key>K</Key></span>
        </div>
      </div>
    </div>
  );
}

function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border px-1 py-0.5 font-sans text-[10px]">
      {children}
    </kbd>
  );
}
