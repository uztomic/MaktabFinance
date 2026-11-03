// =====================================================================
//  Bosh sahifa — o'quv markazi bloki.
//
//  Direktor ertalab ochganda uchta savolga javob: guruhlar qanchalik
//  to'lgan, bugun qanday darslar bor (va davomat olinganmi), voronkada
//  nechta odam kutib turibdi.
// =====================================================================

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useT } from '@/i18n';
import { Notice } from '@/ui';
import { Kpi } from './Groups';

interface Overview {
  groups_active: number;
  groups_forming: number;
  students_active: number;
  members_trial: number;
  members_frozen: number;
  capacity_total: number;
  seats_taken: number;
  joined_month: number;
  left_month: number;
  sessions_today: number;
  sessions_unmarked: number;
  trials_week: number;
  leads_open: number;
}

export function LcOverview() {
  const t = useT();
  const { branchId, can } = useAuth();
  const ov = useQuery({
    queryKey: ['lc-overview', branchId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('lc_overview', {});
      if (error) throw error;
      return data as unknown as Overview;
    },
  });
  const o = ov.data;
  if (!o || !can('students.manage')) return null;

  const fill = o.capacity_total > 0 ? Math.round((100 * o.seats_taken) / o.capacity_total) : null;
  const net = o.joined_month - o.left_month;

  return (
    <section className="mb-4">
      {o.groups_active + o.groups_forming === 0 && (
        <div className="mb-3">
          <Notice tone="brand">
            {t('lc.start.hint')}{' '}
            <Link to="/kurslar" className="font-medium underline">{t('lc.start.courses')}</Link>{' · '}
            <Link to="/guruhlar" className="font-medium underline">{t('lc.start.groups')}</Link>
          </Notice>
        </div>
      )}
      {o.sessions_unmarked > 0 && (
        <div className="mb-3">
          <Notice tone="warn">
            {t('lc.l.unmarkedWarn', { n: o.sessions_unmarked })}{' '}
            <Link to="/davomat" className="font-medium underline">{t('nav.lessons')}</Link>
          </Notice>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <Link to="/guruhlar"><Kpi label={t('lc.kpi.activeGroups')} value={String(o.groups_active)}
          sub={o.groups_forming ? t('lc.kpi.forming', { n: o.groups_forming }) : undefined} /></Link>
        <Link to="/oquvchilar"><Kpi label={t('lc.kpi.students')} value={String(o.students_active)}
          sub={o.members_frozen ? t('lc.kpi.frozenN', { n: o.members_frozen }) : undefined} /></Link>
        <Kpi label={t('lc.kpi.fill')} value={fill === null ? '—' : `${fill}%`}
          sub={o.capacity_total ? `${o.seats_taken} / ${o.capacity_total}` : undefined}
          tone={fill !== null && fill < 60 ? 'danger' : fill !== null && fill >= 85 ? 'ok' : undefined} />
        <Kpi label={t('lc.kpi.netMonth')} value={`${net >= 0 ? '+' : ''}${net}`}
          sub={t('lc.kpi.joinedLeft', { j: o.joined_month, l: o.left_month })}
          tone={net < 0 ? 'danger' : net > 0 ? 'ok' : undefined} />
        <Link to="/davomat"><Kpi label={t('lc.kpi.today')} value={String(o.sessions_today)} sub={t('lc.kpi.lessons')} /></Link>
        <Link to="/murojaatlar"><Kpi label={t('lc.kpi.funnel')} value={String(o.leads_open)}
          sub={o.trials_week ? t('lc.kpi.trialsWeek', { n: o.trials_week }) : undefined}
          tone={o.members_trial > 0 ? 'warn' : undefined} /></Link>
      </div>
    </section>
  );
}
