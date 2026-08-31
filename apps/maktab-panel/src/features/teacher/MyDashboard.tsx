// =====================================================================
//  O'QITUVCHINING BOSH SAHIFASI
//
//  Ilgari o'qituvchi ham DIREKTORNING panelini ko'rardi: maktab
//  bo'yicha o'quvchilar soni, moliyaviy jamlanma, butun maktabdagi
//  nosozliklar. Bu shunchaki noqulaylik emas — o'qituvchiga tegishli
//  bo'lmagan ma'lumot ochiq turardi.
//
//  Bu sahifada faqat uchta savolga javob bor, chunki o'qituvchining
//  ertalabki savoli aynan shu uchtasi:
//
//    · bugun davomat olganmanmi, olmagan bo'lsam qaysi sinfda
//    · shu oyda qancha soat o'tganman
//    · oyligim hisoblanganmi
// =====================================================================

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n, useT } from '@/i18n';
import { currentPeriod, isoDate, money, num, periodLabel } from '@/lib/format';
import {
  Badge, Button, Card, Loading, Notice, PageHeader, Table, Td, Th, Tr,
} from '@/ui';

export default function MyDashboard() {
  const t = useT();
  const { lang } = useI18n();
  const { profile } = useAuth();

  const day = isoDate();
  const period = currentPeriod();

  //  Faqat MENING sinflarim. Server `teachers.user_id = auth.uid()`
  //  bo'yicha filtrlaydi — brauzerga ishonilmaydi.
  const classes = useQuery({
    queryKey: ['my-classes', day],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_classes', { p_day: day });
      if (error) throw error;
      return data ?? [];
    },
  });

  //  Shu oydagi soatlar. `teachers_select_own` siyosati tufayli
  //  o'qituvchi faqat o'z yozuvini ko'radi.
  const me = useQuery({
    queryKey: ['me-teacher'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teachers')
        .select('id, full_name, base_salary, weekly_hours')
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const hours = useQuery({
    queryKey: ['my-hours', period, me.data?.id],
    enabled: !!me.data?.id,
    queryFn: async () => {
      const d = new Date(period);
      const to = isoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
      const { data, error } = await supabase
        .from('lessons')
        .select('hours, kind')
        .eq('teacher_id', me.data!.id)
        .is('deleted_at', null)
        .gte('day', period)
        .lte('day', to);
      if (error) throw error;

      let held = 0, subst = 0, unheld = 0;
      for (const l of data ?? []) {
        const h = Number(l.hours);
        if (l.kind === 'held') held += h;
        else if (l.kind === 'substituted') subst += h;
        else unheld += h;
      }
      return { held, subst, unheld };
    },
  });

  const payroll = useQuery({
    queryKey: ['my-payroll-brief', period],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_payroll_totals')
        .select('net_total, status')
        .eq('period', period)
        .neq('status', 'cancelled')
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  if (classes.isLoading) return <Loading />;

  const list = classes.data ?? [];
  const unchecked = list.filter((c) => !c.marked_at && c.is_workday);

  return (
    <>
      <PageHeader
        title={t('dashboard.title')}
        subtitle={`${profile?.full_name ?? ''} · ${periodLabel(period, lang)}`}
      />

      {/*  Eng muhim narsa TEPADA: davomat olinmagan sinf. Ertalab
          o'qituvchining yagona vazifasi shu. */}
      {unchecked.length > 0 && (
        <div className="mb-4">
          <Notice tone="warn">
            <strong>{t('my.notMarked', { count: unchecked.length })}</strong>{' '}
            <Link to="/davomat" className="font-medium underline">
              {t('nav.myAttendance')}
            </Link>
          </Notice>
        </div>
      )}

      {/*  Menga bog'langan sinf umuman yo'q — bu odatiy hol emas va
          uni jimgina "bo'sh ro'yxat" qilib ko'rsatish noto'g'ri: fan
          o'qituvchisi ham, bog'lanmagan hisob ham shunday ko'rinadi. */}
      {list.length === 0 && (
        <div className="mb-4">
          <Notice tone="neutral">{t('my.noClasses')}</Notice>
        </div>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label={t('lessons.kind.held')}
              value={num(hours.data?.held ?? 0, lang, 1)} />
        <Stat label={t('lessons.kind.substituted')}
              value={num(hours.data?.subst ?? 0, lang, 1)} />
        <Stat
          label={t('nav.myPayroll')}
          value={payroll.data
            ? money(payroll.data.net_total, lang)
            : t('my.payrollPending')}
          hint={payroll.data
            ? t(`payroll.${payroll.data.status === 'approved' ? 'approved' : 'draft'}`)
            : undefined}
        />
      </div>

      {list.length > 0 && (
        <Card title={t('att.byClass')} padded={false}>
          <Table>
            <thead>
              <tr>
                <Th>{t('students.class')}</Th>
                <Th align="right">{t('nav.students')}</Th>
                <Th align="right">{t('att.absent')}</Th>
                <Th>{t('common.status')}</Th>
                <Th align="right">{t('common.actions')}</Th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <Tr key={c.class_id}
                    className={!c.marked_at && c.is_workday
                      ? 'bg-[var(--warn-bg)]' : ''}>
                  <Td className="font-medium">{c.class_name}</Td>
                  <Td align="right" mono>{c.students}</Td>
                  <Td align="right" mono>
                    {c.marked_at ? (c.absent_count ?? 0) : '—'}
                  </Td>
                  <Td>
                    {!c.is_workday
                      ? <Badge tone="neutral">{t('att.dayOff')}</Badge>
                      : c.marked_at
                        ? <Badge tone="ok">{t('att.marked')}</Badge>
                        : <Badge tone="warn">{t('att.notMarked')}</Badge>}
                  </Td>
                  <Td align="right">
                    {c.is_workday && (
                      <Link to="/davomat">
                        <Button size="sm" variant={c.marked_at ? 'ghost' : 'primary'}>
                          {c.marked_at ? t('common.edit') : t('att.mark')}
                        </Button>
                      </Link>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}

function Stat({ label, value, hint }: {
  label: string; value: string; hint?: string;
}) {
  return (
    <div className="rounded-lg border bg-[var(--bg)] px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
        {label}
      </div>
      <div className="num mt-1 text-lg font-semibold">{value}</div>
      {hint && (
        <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">{hint}</div>
      )}
    </div>
  );
}
