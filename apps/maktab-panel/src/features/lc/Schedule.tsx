// =====================================================================
//  Dars jadvali — haftalik ko'rinish.
//
//  Kompyuterda: 7 ustun, vaqt o'qi bo'yicha bloklar (Google Calendar
//  uslubida). Bir vaqtga tushgan guruhlar yonma-yon turadi; bir xona
//  yoki bir o'qituvchi ustma-ust tushsa — qizil chiziq bilan.
//  Telefonda: kun tanlanadi va ro'yxat ko'rinadi.
// =====================================================================

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { useT } from '@/i18n';
import {
  colorFor, type GroupRow, hhmm, isoDow, minutes, useGroups, useRooms, useTeachersList,
  WEEKDAYS,
} from '@/lib/lc';
import { EmptyState, Loading, Notice, PageHeader, Select } from '@/ui';

const HOUR_PX = 56;

interface Placed { g: GroupRow; lane: number; lanes: number; clash: boolean }

export default function Schedule() {
  const t = useT();
  const { branchId, can } = useAuth();
  const groups = useGroups(branchId);
  const rooms = useRooms(branchId);
  const teachers = useTeachersList();
  const [room, setRoom] = useState('');
  const [teacher, setTeacher] = useState('');
  const [day, setDay] = useState(() => isoDow(new Date()));

  const visible = useMemo(() => (groups.data ?? []).filter((g) =>
    g.status !== 'finished' && g.start_time && g.end_time && g.days.length > 0 &&
    (!room || g.room_id === room) && (!teacher || g.teacher_id === teacher)), [groups.data, room, teacher]);

  const { byDay, from, to } = useMemo(() => {
    let lo = 8 * 60, hi = 20 * 60;
    for (const g of visible) {
      lo = Math.min(lo, Math.floor(minutes(g.start_time) / 60) * 60);
      hi = Math.max(hi, Math.ceil(minutes(g.end_time) / 60) * 60);
    }
    const map = new Map<number, Placed[]>();
    for (const d of WEEKDAYS) {
      const items = visible.filter((g) => g.days.includes(d))
        .sort((a, b) => minutes(a.start_time) - minutes(b.start_time));
      // Yo'laklar: ustma-ust tushganlar yonma-yon.
      const lanesEnd: number[] = [];
      const placed: Placed[] = items.map((g) => {
        const s = minutes(g.start_time);
        let lane = lanesEnd.findIndex((end) => end <= s);
        if (lane === -1) { lane = lanesEnd.length; lanesEnd.push(0); }
        lanesEnd[lane] = minutes(g.end_time);
        return { g, lane, lanes: 1, clash: false };
      });
      for (const p of placed) {
        const overl = placed.filter((o) => o !== p &&
          minutes(o.g.start_time) < minutes(p.g.end_time) && minutes(o.g.end_time) > minutes(p.g.start_time));
        p.lanes = Math.max(1, ...overl.map((o) => o.lane + 1), p.lane + 1);
        p.clash = overl.some((o) => (o.g.room_id && o.g.room_id === p.g.room_id)
          || (o.g.teacher_id && o.g.teacher_id === p.g.teacher_id));
      }
      map.set(d, placed);
    }
    return { byDay: map, from: lo, to: hi };
  }, [visible]);

  if (!can('students.manage')) return <Notice tone="danger">{t('common.noAccess')}</Notice>;
  if (groups.isLoading) return <Loading />;

  const hours: number[] = [];
  for (let m = from; m < to; m += 60) hours.push(m);
  const clashes = [...byDay.values()].flat().filter((p) => p.clash).length;
  const today = isoDow(new Date());

  return (
    <>
      <PageHeader title={t('lc.scheduleTitle')} subtitle={t('lc.scheduleSub', { n: visible.length })} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select value={room} onChange={(e) => setRoom(e.target.value)} className="w-auto min-w-[10rem]">
          <option value="">{t('lc.allRooms')}</option>
          {(rooms.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </Select>
        <Select value={teacher} onChange={(e) => setTeacher(e.target.value)} className="w-auto min-w-[10rem]">
          <option value="">{t('lc.allTeachers')}</option>
          {(teachers.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.full_name}</option>)}
        </Select>
        {clashes > 0 && <Notice tone="danger">{t('lc.clashes', { n: clashes / 2 })}</Notice>}
      </div>

      {visible.length === 0 ? <EmptyState title={t('lc.scheduleEmpty')} hint={t('lc.scheduleEmptyHint')} /> : (
        <>
          {/* --- Telefon: kun bo'yicha ro'yxat ----------------------- */}
          <div className="md:hidden">
            <div className="mb-3 grid grid-cols-7 gap-1">
              {WEEKDAYS.map((d) => (
                <button key={d} type="button" onClick={() => setDay(d)}
                  className={`rounded-lg py-2 text-[12px] font-medium ${day === d ? 'bg-brand-900 text-white'
                    : d === today ? 'border border-brand-600' : 'border'}`}>
                  {t(`lc.dowShort.${d}`)}
                  <span className="block text-[10px] opacity-70">{byDay.get(d)?.length ?? 0}</span>
                </button>
              ))}
            </div>
            <ul className="space-y-2">
              {(byDay.get(day) ?? []).map(({ g, clash }) => (
                <li key={g.id}>
                  <Link to={`/guruhlar/${g.id}`} className="flex gap-3 rounded-xl border bg-[var(--bg)] p-3">
                    <span className="w-1 shrink-0 rounded-full" style={{ background: colorFor(g.course_id ?? g.id, g.courses?.color) }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-semibold">{g.name}</span>
                        <span className="num text-[13px]">{hhmm(g.start_time)}–{hhmm(g.end_time)}</span>
                      </div>
                      <div className="truncate text-[12px] text-[var(--text-muted)]">
                        {g.teachers?.full_name ?? '—'} · {g.is_online ? t('lc.online') : (g.rooms?.name ?? '—')}
                      </div>
                      {clash && <div className="mt-1 text-[11px] font-medium text-[var(--danger)]">{t('lc.clash')}</div>}
                    </div>
                  </Link>
                </li>
              ))}
              {(byDay.get(day) ?? []).length === 0 && <EmptyState title={t('lc.noLessonsDay')} hint=" " />}
            </ul>
          </div>

          {/* --- Kompyuter: haftalik to'r ---------------------------- */}
          <div className="hidden overflow-x-auto rounded-xl border bg-[var(--bg)] shadow-[var(--shadow-card)] md:block">
            <div className="grid min-w-[56rem]" style={{ gridTemplateColumns: '3.5rem repeat(7, minmax(0, 1fr))' }}>
              <div className="border-b bg-[var(--bg-subtle)]" />
              {WEEKDAYS.map((d) => (
                <div key={d} className={`border-b border-l px-2 py-2 text-center text-[12px] font-semibold
                  ${d === today ? 'bg-[var(--sel-bg)] text-[var(--sel-text)]' : 'bg-[var(--bg-subtle)] text-[var(--text-muted)]'}`}>
                  {t(`lc.dow.${d}`)}
                </div>
              ))}

              <div className="relative" style={{ height: ((to - from) / 60) * HOUR_PX }}>
                {hours.map((m) => (
                  <div key={m} className="absolute right-1.5 -translate-y-1/2 text-[10px] text-[var(--text-faint)] num"
                       style={{ top: ((m - from) / 60) * HOUR_PX }}>
                    {String(m / 60).padStart(2, '0')}:00
                  </div>
                ))}
              </div>

              {WEEKDAYS.map((d) => (
                <div key={d} className="relative border-l" style={{ height: ((to - from) / 60) * HOUR_PX }}>
                  {hours.map((m) => (
                    <div key={m} className="absolute inset-x-0 border-t border-[var(--border-soft)]"
                         style={{ top: ((m - from) / 60) * HOUR_PX }} />
                  ))}
                  {(byDay.get(d) ?? []).map(({ g, lane, lanes, clash }) => {
                    const top = ((minutes(g.start_time) - from) / 60) * HOUR_PX;
                    const h = Math.max(22, ((minutes(g.end_time) - minutes(g.start_time)) / 60) * HOUR_PX - 2);
                    const color = colorFor(g.course_id ?? g.id, g.courses?.color);
                    return (
                      <Link key={g.id} to={`/guruhlar/${g.id}`}
                        className={`absolute overflow-hidden rounded-md px-1.5 py-1 text-[11px] leading-tight text-white
                          shadow-sm transition-transform hover:z-10 hover:scale-[1.02] ${clash ? 'ring-2 ring-[var(--danger)]' : ''}`}
                        style={{
                          top, height: h, background: color,
                          left: `calc(${(100 * lane) / lanes}% + 2px)`,
                          width: `calc(${100 / lanes}% - 4px)`,
                        }}
                        title={`${g.name} · ${hhmm(g.start_time)}–${hhmm(g.end_time)} · ${g.teachers?.full_name ?? ''} · ${g.rooms?.name ?? ''}`}>
                        <div className="truncate font-semibold">{g.name}</div>
                        <div className="truncate opacity-90">{hhmm(g.start_time)}–{hhmm(g.end_time)}</div>
                        {h > 44 && <div className="truncate opacity-90">{g.rooms?.name ?? (g.is_online ? t('lc.online') : '')}</div>}
                        {h > 60 && <div className="truncate opacity-80">{g.teachers?.full_name}</div>}
                      </Link>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}
