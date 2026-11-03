// =====================================================================
//  Guruhlar — o'quv markazining asosiy ekrani.
//
//  Bir qarashda: qaysi guruh to'lgan, qayerda bo'sh o'rin bor, kim
//  dars beradi, qachon va qayerda, oyiga qancha. Kartochka ko'rinishi
//  — telefonda ham qulay; jadval ko'rinishi — ko'p guruhli markaz uchun.
// =====================================================================

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n, useT } from '@/i18n';
import { money } from '@/lib/format';
import { exportTable } from '@/lib/export';
import {
  colorFor, type GroupRow, hhmm, useCourses, useGroups, useMemberCounts,
  usePrices, useTeachersList,
} from '@/lib/lc';
import {
  Badge, Button, EmptyState, ErrorState, Input, Loading, Notice, PageHeader,
  Select, Table, Td, Th, Tr,
} from '@/ui';
import { FilterChips } from '@/ui/Feedback';
import { GroupForm } from './GroupForm';

type View = 'cards' | 'table';
type StatusFilter = 'active' | 'forming' | 'finished';

export default function Groups() {
  const t = useT();
  const { lang } = useI18n();
  const nav = useNavigate();
  const { branchId, can, mayWrite } = useAuth();

  const groups = useGroups(branchId);
  const counts = useMemberCounts(branchId);
  const courses = useCourses();
  const teachers = useTeachersList();
  const prices = usePrices((groups.data ?? []).map((g) => g.service_id).filter(Boolean) as string[]);

  const [q, setQ] = useState('');
  const [status, setStatus] = useState<StatusFilter | ''>('active');
  const [course, setCourse] = useState('');
  const [teacher, setTeacher] = useState('');
  const [view, setView] = useState<View>(() => {
    try { return (localStorage.getItem('lc-groups-view') as View) || 'cards'; } catch { return 'cards'; }
  });
  const [adding, setAdding] = useState(false);

  const setViewSaved = (v: View) => {
    setView(v);
    try { localStorage.setItem('lc-groups-view', v); } catch { /* ahamiyatsiz */ }
  };

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (groups.data ?? []).filter((g) =>
      (!status || g.status === status) &&
      (!course || g.course_id === course) &&
      (!teacher || g.teacher_id === teacher) &&
      (!needle || g.name.toLowerCase().includes(needle)
        || g.teachers?.full_name.toLowerCase().includes(needle)
        || g.courses?.name.toLowerCase().includes(needle)));
  }, [groups.data, q, status, course, teacher]);

  const stat = useMemo(() => {
    const all = groups.data ?? [];
    let seats = 0, taken = 0, students = 0, trial = 0, revenue = 0;
    for (const g of all) {
      if (g.status === 'finished') continue;
      const c = counts.data?.get(g.id);
      students += c?.active ?? 0;
      trial += c?.trial ?? 0;
      if (g.capacity) { seats += g.capacity; taken += (c?.active ?? 0) + (c?.frozen ?? 0); }
      revenue += (c?.active ?? 0) * (prices.data?.get(g.service_id ?? '') ?? 0);
    }
    return { seats, taken, students, trial, revenue, active: all.filter((g) => g.status === 'active').length };
  }, [groups.data, counts.data, prices.data]);

  if (!can('students.manage')) return <Notice tone="danger">{t('common.noAccess')}</Notice>;
  if (groups.isLoading) return <Loading />;
  if (groups.error) return <ErrorState message={(groups.error as Error).message} onRetry={() => groups.refetch()} />;

  const fill = stat.seats > 0 ? Math.round((100 * stat.taken) / stat.seats) : null;

  return (
    <>
      <PageHeader
        title={t('lc.groups')}
        subtitle={t('common.showing', { count: list.length })}
        actions={
          <>
            <Button disabled={list.length === 0} onClick={() => exportTable(
              'guruhlar',
              [
                { header: t('lc.group.name'), value: (g: GroupRow) => g.name },
                { header: t('lc.course'), value: (g: GroupRow) => g.courses?.name ?? '' },
                { header: t('lc.teacher'), value: (g: GroupRow) => g.teachers?.full_name ?? '' },
                { header: t('lc.room'), value: (g: GroupRow) => g.rooms?.name ?? '' },
                { header: t('lc.days'), value: (g: GroupRow) => daysLabel(g.days, t) },
                { header: t('lc.time'), value: (g: GroupRow) => `${hhmm(g.start_time)}–${hhmm(g.end_time)}` },
                { header: t('lc.students'), value: (g: GroupRow) => counts.data?.get(g.id)?.active ?? 0, numeric: true },
                { header: t('lc.capacity'), value: (g: GroupRow) => g.capacity ?? '', numeric: true },
                { header: t('lc.price'), value: (g: GroupRow) => prices.data?.get(g.service_id ?? '') ?? '', numeric: true },
              ],
              list,
              [t('lc.groups')],
            )}>
              {t('common.export')}
            </Button>
            {mayWrite('students.manage') && (
              <Button variant="primary" onClick={() => setAdding(true)}>{t('lc.group.add')}</Button>
            )}
          </>
        }
      />

      {/* --- Jamlanma ---------------------------------------------- */}
      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-5">
        <Kpi label={t('lc.kpi.activeGroups')} value={String(stat.active)} />
        <Kpi label={t('lc.kpi.students')} value={String(stat.students)} />
        <Kpi label={t('lc.kpi.trial')} value={String(stat.trial)} tone={stat.trial > 0 ? 'warn' : undefined} />
        <Kpi label={t('lc.kpi.fill')} value={fill === null ? '—' : `${fill}%`}
             sub={stat.seats ? `${stat.taken} / ${stat.seats}` : undefined}
             tone={fill !== null && fill < 60 ? 'danger' : fill !== null && fill >= 85 ? 'ok' : undefined} />
        <Kpi label={t('lc.kpi.monthly')} value={money(stat.revenue, lang)} sub={t('lc.kpi.monthlyHint')} />
      </div>

      {/* --- Filtrlar ------------------------------------------------ */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <FilterChips<StatusFilter>
          value={status}
          onChange={setStatus}
          options={[
            { value: 'active', label: t('lc.gstatus.active') },
            { value: 'forming', label: t('lc.gstatus.forming') },
            { value: 'finished', label: t('lc.gstatus.finished') },
          ]}
          allLabel={t('common.all')}
        />
        <Input placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)}
               className="w-auto min-w-[12rem] flex-1 sm:flex-none" />
        <Select value={course} onChange={(e) => setCourse(e.target.value)} className="w-auto min-w-[10rem]">
          <option value="">{t('lc.allCourses')}</option>
          {(courses.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}{c.level ? ` · ${c.level}` : ''}</option>)}
        </Select>
        <Select value={teacher} onChange={(e) => setTeacher(e.target.value)} className="w-auto min-w-[10rem]">
          <option value="">{t('lc.allTeachers')}</option>
          {(teachers.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.full_name}</option>)}
        </Select>
        <div className="ml-auto flex rounded-lg border p-0.5">
          {(['cards', 'table'] as View[]).map((v) => (
            <button key={v} type="button" onClick={() => setViewSaved(v)}
              className={`rounded-md px-2.5 py-1 text-[12px] font-medium ${view === v
                ? 'bg-[var(--bg-inset)] text-[var(--text)]' : 'text-[var(--text-muted)]'}`}>
              {t(`lc.view.${v}`)}
            </button>
          ))}
        </div>
      </div>

      {list.length === 0 ? (
        <EmptyState
          title={(groups.data ?? []).length === 0 ? t('lc.group.emptyTitle') : undefined}
          hint={(groups.data ?? []).length === 0 ? t('lc.group.emptyHint') : undefined}
          action={mayWrite('students.manage') && (groups.data ?? []).length === 0 && (
            <Button variant="primary" onClick={() => setAdding(true)}>{t('lc.group.add')}</Button>
          )}
        />
      ) : view === 'cards' ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((g) => {
            const c = counts.data?.get(g.id);
            const price = prices.data?.get(g.service_id ?? '');
            const taken = (c?.active ?? 0) + (c?.frozen ?? 0);
            const pct = g.capacity ? Math.min(100, Math.round((100 * taken) / g.capacity)) : null;
            const color = colorFor(g.course_id ?? g.id, g.courses?.color);
            return (
              <Link key={g.id} to={`/guruhlar/${g.id}`}
                className="group relative overflow-hidden rounded-xl border bg-[var(--bg)] p-4
                  shadow-[var(--shadow-card)] transition-shadow hover:shadow-md">
                <span className="absolute inset-y-0 left-0 w-1" style={{ background: color }} />
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-semibold">{g.name}</div>
                    <div className="truncate text-[12px] text-[var(--text-muted)]">
                      {g.courses?.name ?? t('lc.noCourse')}{g.courses?.level ? ` · ${g.courses.level}` : ''}
                    </div>
                  </div>
                  <StatusBadge status={g.status} />
                </div>

                <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[13px]">
                  <Meta icon="👤" text={g.teachers?.full_name ?? '—'} />
                  <Meta icon="🚪" text={g.is_online ? t('lc.online') : (g.rooms?.name ?? '—')} />
                  <Meta icon="📅" text={daysLabel(g.days, t) || '—'} />
                  <Meta icon="🕑" text={g.start_time ? `${hhmm(g.start_time)}–${hhmm(g.end_time)}` : '—'} />
                </div>

                <div className="mt-3">
                  <div className="mb-1 flex items-center justify-between text-[12px]">
                    <span className="text-[var(--text-muted)]">
                      {t('lc.seats', { taken, cap: g.capacity ?? '∞' })}
                      {(c?.trial ?? 0) > 0 && <span className="ml-1.5 text-[var(--warn)]">+{c!.trial} {t('lc.trialShort')}</span>}
                    </span>
                    <span className="num font-medium">{price != null ? money(price, lang) : '—'}</span>
                  </div>
                  {pct !== null && (
                    <div className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-inset)]">
                      <div className="h-full rounded-full transition-all"
                           style={{
                             width: `${pct}%`,
                             background: pct >= 100 ? 'var(--danger)' : pct >= 85 ? 'var(--ok)' : color,
                           }} />
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t('lc.group.name')}</Th>
              <Th>{t('lc.course')}</Th>
              <Th>{t('lc.teacher')}</Th>
              <Th>{t('lc.room')}</Th>
              <Th>{t('lc.schedule')}</Th>
              <Th align="right">{t('lc.students')}</Th>
              <Th align="right">{t('lc.price')}</Th>
              <Th>{t('common.status')}</Th>
            </tr>
          </thead>
          <tbody>
            {list.map((g) => {
              const c = counts.data?.get(g.id);
              return (
                <Tr key={g.id} onClick={() => nav(`/guruhlar/${g.id}`)}>
                  <Td className="font-medium">{g.name}</Td>
                  <Td>{g.courses?.name ?? '—'}</Td>
                  <Td>{g.teachers?.full_name ?? '—'}</Td>
                  <Td>{g.is_online ? t('lc.online') : (g.rooms?.name ?? '—')}</Td>
                  <Td>{daysLabel(g.days, t)} {g.start_time ? `${hhmm(g.start_time)}–${hhmm(g.end_time)}` : ''}</Td>
                  <Td align="right" mono>
                    {(c?.active ?? 0) + (c?.frozen ?? 0)}{g.capacity ? ` / ${g.capacity}` : ''}
                    {(c?.trial ?? 0) > 0 && <span className="ml-1 text-[var(--warn)]">+{c!.trial}</span>}
                  </Td>
                  <Td align="right" mono>{money(prices.data?.get(g.service_id ?? '') ?? 0, lang)}</Td>
                  <Td><StatusBadge status={g.status} /></Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}

      <GroupForm open={adding} group={null} onClose={() => setAdding(false)}
                 onSaved={(id) => nav(`/guruhlar/${id}`)} />
    </>
  );
}

export function daysLabel(days: number[] | null | undefined, t: (k: string) => string): string {
  const d = [...(days ?? [])].sort();
  if (d.join() === '1,3,5') return t('lc.preset.odd');
  if (d.join() === '2,4,6') return t('lc.preset.even');
  return d.map((x) => t(`lc.dowShort.${x}`)).join(', ');
}

export function StatusBadge({ status }: { status: string }) {
  const t = useT();
  const tone = status === 'active' ? 'ok' : status === 'forming' ? 'warn' : 'neutral';
  return <Badge tone={tone}>{t(`lc.gstatus.${status}`)}</Badge>;
}

function Meta({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span aria-hidden className="text-[12px] opacity-70">{icon}</span>
      <span className="truncate">{text}</span>
    </div>
  );
}

export function Kpi({ label, value, sub, tone }: {
  label: string; value: string; sub?: string; tone?: 'ok' | 'warn' | 'danger';
}) {
  const color = tone === 'ok' ? 'text-[var(--ok)]' : tone === 'warn' ? 'text-[var(--warn)]'
    : tone === 'danger' ? 'text-[var(--danger)]' : '';
  return (
    <div className="rounded-xl border bg-[var(--bg)] px-3 py-2.5 shadow-[var(--shadow-card)]">
      <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">{label}</div>
      <div className={`num mt-0.5 text-lg font-semibold ${color}`}>{value}</div>
      {sub && <div className="text-[11px] text-[var(--text-faint)]">{sub}</div>}
    </div>
  );
}
