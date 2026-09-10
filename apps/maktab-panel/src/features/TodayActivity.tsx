// =====================================================================
//  BUGUNGI AMALLAR
//
//  Direktorning kunlik savoli: "bugun maktabda nima bo'ldi?"
//
//  Javob bazada allaqachon bor edi — audit jurnali har bir o'zgarishni
//  yozib boradi. Lekin u xom ko'rinishda: jadval nomi, ustun nomi va
//  ikkita JSON. `/jurnal` sahifasi aynan shuni ko'rsatadi va u
//  TEKSHIRUV uchun to'g'ri — biror raqam qayerdan kelganini topish
//  kerak bo'lganda.
//
//  Bu esa boshqa savol: kun davomida nima bo'lganini BIR QARASHDA
//  ko'rish. Shuning uchun bu yerda jadval emas, tasma: soat, gap,
//  kim qilgani. Har bir satr o'sha yozuvga olib boradi.
//
//  Nega bosh sahifada: bu kunni boshlash oynasi. Direktor ertalab
//  panelni ochadi va kecha kim nima qilganini ko'radi — buning uchun
//  alohida sahifaga o'tishi shart emas.
// =====================================================================

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n, useT } from '@/i18n';
import { isoDate, type Lang, money } from '@/lib/format';
import {
  Badge, Button, Card, EmptyState, ErrorState, Input, Loading,
} from '@/ui';

type Row = {
  happened_at: string;
  kind: string;
  act: string;
  obj: string;
  subject: string | null;
  amount: number | null;
  n: number;
  actor: string | null;
  support: boolean;
  href: string | null;
};

/**
 *  Har bir amal turiga belgi.
 *
 *  Rang emas, BELGI: ro'yxatda yigirmata satr bo'lganda ko'z avval
 *  shaklga tushadi. Rang bilan ajratilsa, ko'r-rang odam uchun ham,
 *  bosib chiqarilganda ham farq yo'qoladi.
 */
const ICON: Record<string, string> = {
  student: '👤',
  payment: '💵',
  discount: '🎁',
  invoice: '🧾',
  contract: '📄',
  absence: '📋',
  attendance: '📋',
  lesson: '📚',
  payroll: '💼',
  expense: '💸',
  teacher: '🎓',
  class: '🏫',
  user: '🔑',
  parent: '👪',
  service: '➕',
  proof: '📎',
  settings: '⚙️',
  calendar: '📅',
  period: '🔒',
  lead: '📞',
  price: '🏷',
  paymethod: '💳',
  expcat: '💸',
  disctype: '🎁',
  reason: '📋',
  allowance: '💼',
  advance: '💼',
  branch: '🏢',
  branchlink: '🏢',
  permission: '🔑',
  subscription: '📆',
};

/** Sukut bo'yicha nechta satr ko'rinadi. */
const SHORT = 12;

export function TodayActivity() {
  const t = useT();
  const { lang } = useI18n();
  const { branchId, can } = useAuth();

  const [day, setDay] = useState(isoDate());
  const [all, setAll] = useState(false);

  const isToday = day === isoDate();

  const rows = useQuery({
    queryKey: ['today-activity', day, branchId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('today_activity', {
        p_branch_id: branchId ?? undefined,
        p_day: day,
        p_limit: 120,
      });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    //  Bugungi kun tirik ro'yxat: kassada to'lov qabul qilinsa,
    //  direktorning ekranida o'zi paydo bo'lishi kerak. O'tgan kun
    //  o'zgarmaydi — uni qayta so'rashning ma'nosi yo'q.
    refetchInterval: isToday ? 60_000 : false,
  });

  if (!can('reports.view')) return null;

  const list = rows.data ?? [];
  const shown = all ? list : list.slice(0, SHORT);

  return (
    <Card
      title={
        <span className="flex flex-col">
          <span>{t('act.title')}</span>
          <span className="text-[12px] font-normal text-[var(--text-muted)]">
            {t('act.hint')}
          </span>
        </span>
      }
      action={
        <div className="flex flex-wrap items-center gap-1.5">
          <Input
            type="date"
            value={day}
            max={isoDate()}
            onChange={(e) => { setDay(e.target.value); setAll(false); }}
            className="w-auto"
          />
          <Link to="/jurnal">
            <Button size="sm" variant="ghost">{t('act.all')}</Button>
          </Link>
        </div>
      }
      padded={false}
    >
      {rows.isLoading ? <div className="p-4"><Loading /></div>
        : rows.error
          ? (
            <div className="p-4">
              <ErrorState message={(rows.error as Error).message}
                          onRetry={() => rows.refetch()} />
            </div>
          )
          : list.length === 0
            ? <EmptyState hint={t('act.empty')} />
            : (
              <>
                <ol className="divide-y">
                  {shown.map((r, i) => (
                    <ActivityRow key={`${r.happened_at}-${r.kind}-${i}`}
                                 row={r} lang={lang} t={t} />
                  ))}
                </ol>

                {!all && list.length > SHORT && (
                  <div className="border-t p-2 text-center">
                    <Button size="sm" variant="ghost"
                            onClick={() => setAll(true)}>
                      {t('act.showAll', { n: list.length })}
                    </Button>
                  </div>
                )}
              </>
            )}
    </Card>
  );
}

// ---------------------------------------------------------------------

function ActivityRow({ row, lang, t }: {
  row: Row;
  lang: Lang;
  t: (k: string, v?: Record<string, string | number>) => string;
}) {
  //  Turi `oila.amal` ko'rinishida: `student.add`. Belgisi oila
  //  bo'yicha tanlanadi, matni esa to'liq kalit bilan.
  const family = row.kind.split('.')[0];
  const icon = ICON[family] ?? '•';

  //  Tanilmagan jadval ham YO'QOLMAYDI: jurnaldagi nomi bilan
  //  chiqadi. Ertaga yangi imkoniyat qo'shilsa, u shu tasmadan
  //  jimgina tushib qolmasligi kerak.
  //
  //  Tarjimasi bo'lmasa `t()` kalitning o'zini qaytaradi — ekranda
  //  "audit.table.discount_types" turib qolardi. Bunday holda
  //  jadvalning xom nomi ko'rsatiladi: chiroyli emas, lekin
  //  tushunarli va nimadir bo'lgani ko'rinib turadi.
  const objLabel = (() => {
    const key = `audit.table.${row.obj}`;
    const val = t(key);
    return val === key ? row.obj : val;
  })();

  const label = row.kind === 'other'
    ? `${objLabel} — ${t(`audit.action.${row.act}`)}`
    : t(`act.${row.kind}`);

  const time = new Date(row.happened_at)
    .toLocaleTimeString(lang === 'ru' ? 'ru-RU' : 'uz-UZ',
                        { hour: '2-digit', minute: '2-digit' });

  const body = (
    <div className="flex items-start gap-2.5 px-3 py-2">
      <span className="num w-10 shrink-0 pt-0.5 text-[12px]
        text-[var(--text-muted)]">{time}</span>
      <span className="shrink-0 pt-0.5 text-[15px] leading-none">{icon}</span>

      <div className="min-w-0 flex-1">
        <div className="text-[13px]">
          <span>{label}</span>
          {row.n > 1 && (
            <span className="num ml-1.5 rounded bg-[var(--bg-inset)] px-1.5
              py-0.5 text-[11px] text-[var(--text-muted)]">
              {t('act.count', { n: row.n })}
            </span>
          )}
          {row.subject && (
            <span className="font-medium"> — {row.subject}</span>
          )}
          {row.amount != null && row.amount > 0 && (
            <span className="num font-semibold"> · {money(row.amount, lang)}</span>
          )}
        </div>

        <div className="mt-0.5 flex flex-wrap items-center gap-1.5
          text-[12px] text-[var(--text-muted)]">
          <span>{row.actor ?? t('act.system')}</span>
          {/*  TZ 4.13.5.2 — texnik yordam rejimidagi amal mijozdan
              yashirilmaydi. */}
          {row.support && <Badge tone="warn">{t('act.support')}</Badge>}
        </div>
      </div>
    </div>
  );

  return (
    <li>
      {row.href
        ? <Link to={row.href} className="block hover:bg-[var(--bg-subtle)]">{body}</Link>
        : body}
    </li>
  );
}
