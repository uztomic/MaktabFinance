// =====================================================================
//  Guruh kartochkasi.
//
//  Uch varaq:
//    · O'quvchilar — a'zolik, sinov darsi, muzlatish, o'tkazish, qarz
//    · Darslar     — oy bo'yicha, davomat bir bosishda
//    · Jurnal      — o'quvchi × dars jadvali (davomat va baho)
//
//  Har bir amal server funksiyasi orqali — hisob-kitob (xizmatni ochish
//  / yopish) bazada bajariladi, panel faqat so'raydi.
// =====================================================================

import { type FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n, useT } from '@/i18n';
import { date, isoDate, money, periodLabel } from '@/lib/format';
import {
  colorFor, GROUP_SELECT, type GroupRow, hhmm, type MemberStatus, monthEnd, monthStart,
  usePrices,
} from '@/lib/lc';
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Input, Loading, Modal, Money,
  Notice, PageHeader, Select, Table, Td, Th, Tr,
} from '@/ui';
import { useConfirm, useToast } from '@/ui/Feedback';
import { GroupForm } from './GroupForm';
import { daysLabel, Kpi, StatusBadge } from './Groups';
import { SessionAttendance, type SessionLite } from './SessionAttendance';

type Tab = 'members' | 'lessons' | 'journal';

const MTONE: Record<MemberStatus, 'ok' | 'warn' | 'neutral' | 'brand'> = {
  active: 'ok', trial: 'warn', frozen: 'brand', left: 'neutral',
};

export default function GroupCard() {
  const { id } = useParams<{ id: string }>();
  const t = useT();
  const { lang } = useI18n();
  const { mayWrite, can } = useAuth();
  const [tab, setTab] = useState<Tab>('members');
  const [editing, setEditing] = useState(false);

  const group = useQuery({
    queryKey: ['lc-group', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('study_groups').select(GROUP_SELECT)
        .eq('id', id!).maybeSingle();
      if (error) throw error;
      return data as unknown as GroupRow | null;
    },
  });
  const g = group.data;
  const prices = usePrices(g?.service_id ? [g.service_id] : []);
  const price = g?.service_id ? prices.data?.get(g.service_id) ?? null : null;

  const members = useQuery({
    queryKey: ['lc-members', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('group_members')
        .select('id, student_id, status, joined_on, left_on, left_reason, trial_on, note, students(full_name, payment_code)')
        .eq('group_id', id!).order('status').order('joined_on');
      if (error) throw error;
      // deno-lint-ignore no-explicit-any
      return (data ?? []) as any[];
    },
  });

  const balances = useQuery({
    queryKey: ['lc-member-balances', id, (members.data ?? []).length],
    enabled: (members.data ?? []).length > 0,
    queryFn: async () => {
      const ids = (members.data ?? []).map((m) => m.student_id);
      const { data, error } = await supabase.from('v_student_balances')
        .select('student_id, balance').in('student_id', ids);
      if (error) throw error;
      return new Map<string, number>((data ?? []).map((b) => [b.student_id!, Number(b.balance ?? 0)] as const));
    },
  });

  if (!can('students.manage')) return <Notice tone="danger">{t('common.noAccess')}</Notice>;
  if (group.isLoading) return <Loading />;
  if (group.error) return <ErrorState message={(group.error as Error).message} onRetry={() => group.refetch()} />;
  if (!g) return <EmptyState title={t('lc.group.notFound')} action={<Link to="/guruhlar" className="text-brand-600 underline">{t('common.back')}</Link>} />;

  const ms = members.data ?? [];
  const active = ms.filter((m) => m.status === 'active').length;
  const frozen = ms.filter((m) => m.status === 'frozen').length;
  const trial = ms.filter((m) => m.status === 'trial').length;
  const debtors = ms.filter((m) => m.status !== 'left' && (balances.data?.get(m.student_id) ?? 0) > 0).length;
  const color = colorFor(g.course_id ?? g.id, g.courses?.color);

  return (
    <>
      <div className="mb-2 text-[13px]">
        <Link to="/guruhlar" className="text-[var(--text-muted)] hover:underline">← {t('lc.groups')}</Link>
      </div>
      <PageHeader
        title={g.name}
        subtitle={[
          g.courses?.name, g.teachers?.full_name,
          `${daysLabel(g.days, t)} ${g.start_time ? `${hhmm(g.start_time)}–${hhmm(g.end_time)}` : ''}`,
          g.is_online ? t('lc.online') : g.rooms?.name,
        ].filter(Boolean).join(' · ')}
        actions={mayWrite('students.manage') && (
          <Button onClick={() => setEditing(true)}>{t('common.edit')}</Button>
        )}
      />

      <div className="mb-4 h-1 rounded-full" style={{ background: color }} />

      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-5">
        <Kpi label={t('lc.kpi.students')} value={`${active + frozen}${g.capacity ? ` / ${g.capacity}` : ''}`}
             sub={frozen ? t('lc.kpi.frozenN', { n: frozen }) : undefined} />
        <Kpi label={t('lc.kpi.trial')} value={String(trial)} tone={trial ? 'warn' : undefined} />
        <Kpi label={t('lc.price')} value={price != null ? money(price, lang) : '—'} />
        <Kpi label={t('lc.kpi.debtors')} value={String(debtors)} tone={debtors ? 'danger' : undefined} />
        <div className="flex items-center rounded-xl border bg-[var(--bg)] px-3 py-2.5 shadow-[var(--shadow-card)]">
          <StatusBadge status={g.status} />
          {g.teacher_pay_kind && (
            <span className="ml-2 text-[12px] text-[var(--text-muted)]">
              {t(`lc.pay.${g.teacher_pay_kind}`)}: {g.teacher_pay_kind === 'percent'
                ? `${Number(g.teacher_pay_value ?? 0)}%` : money(g.teacher_pay_value ?? 0, lang)}
            </span>
          )}
        </div>
      </div>

      <div className="mb-3 flex gap-1 border-b">
        {(['members', 'lessons', 'journal'] as Tab[]).map((x) => (
          <button key={x} type="button" onClick={() => setTab(x)}
            className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-medium ${tab === x
              ? 'border-brand-700 text-[var(--text)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'}`}>
            {t(`lc.tab.${x}`)}
          </button>
        ))}
      </div>

      {tab === 'members' && <Members group={g} members={ms} balances={balances.data} />}
      {tab === 'lessons' && <Lessons group={g} />}
      {tab === 'journal' && <Journal group={g} />}

      <GroupForm open={editing} group={g} currentPrice={price} onClose={() => setEditing(false)} />
    </>
  );
}

// ---------------------------------------------------------------------
//  O'QUVCHILAR
// ---------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
function Members({ group, members, balances }: { group: GroupRow; members: any[]; balances?: Map<string, number> }) {
  const t = useT();
  const { lang } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const { mayWrite } = useAuth();
  const canEdit = mayWrite('students.manage');

  const [showLeft, setShowLeft] = useState(false);
  const [adding, setAdding] = useState(false);
  // deno-lint-ignore no-explicit-any
  const [freezing, setFreezing] = useState<any>(null);
  // deno-lint-ignore no-explicit-any
  const [leaving, setLeaving] = useState<any>(null);
  // deno-lint-ignore no-explicit-any
  const [moving, setMoving] = useState<any>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['lc-members', group.id] });
    qc.invalidateQueries({ queryKey: ['lc-member-counts'] });
    qc.invalidateQueries({ queryKey: ['lc-member-balances'] });
    qc.invalidateQueries({ queryKey: ['students'] });
  };

  const activate = useMutation({
    mutationFn: async (memberId: string) => {
      const { error } = await supabase.rpc('activate_group_member', { p_member_id: memberId, p_from: isoDate() });
      if (error) throw error;
    },
    onSuccess: () => { toast.ok(t('lc.m.activated')); refresh(); },
    onError: (e) => toast.error((e as Error).message),
  });

  const list = members.filter((m) => showLeft || m.status !== 'left');
  const leftCount = members.filter((m) => m.status === 'left').length;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {canEdit && group.status !== 'finished' && (
          <Button variant="primary" onClick={() => setAdding(true)}>{t('lc.m.add')}</Button>
        )}
        {leftCount > 0 && (
          <label className="ml-auto flex items-center gap-2 text-[13px] text-[var(--text-muted)]">
            <input type="checkbox" checked={showLeft} onChange={(e) => setShowLeft(e.target.checked)} />
            {t('lc.m.showLeft', { n: leftCount })}
          </label>
        )}
      </div>

      {list.length === 0 ? (
        <EmptyState title={t('lc.m.emptyTitle')} hint={t('lc.m.emptyHint')} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t('lc.student')}</Th>
              <Th>{t('common.status')}</Th>
              <Th>{t('lc.m.joined')}</Th>
              <Th align="right">{t('lc.m.balance')}</Th>
              {canEdit && <Th align="right">{t('common.actions')}</Th>}
            </tr>
          </thead>
          <tbody>
            {list.map((m) => {
              const bal = balances?.get(m.student_id) ?? 0;
              return (
                <Tr key={m.id}>
                  <Td>
                    <Link to={`/oquvchilar/${m.student_id}`} className="font-medium hover:underline">
                      {m.students?.full_name}
                    </Link>
                    <span className="ml-2 text-[11px] text-[var(--text-faint)]">{m.students?.payment_code}</span>
                  </Td>
                  <Td>
                    <Badge tone={MTONE[m.status as MemberStatus]}>{t(`lc.mstatus.${m.status}`)}</Badge>
                    {m.status === 'trial' && m.trial_on && (
                      <span className="ml-1.5 text-[12px] text-[var(--text-muted)]">{date(m.trial_on, lang)}</span>
                    )}
                    {m.status === 'left' && m.left_reason && (
                      <span className="ml-1.5 text-[12px] text-[var(--text-muted)]">{m.left_reason}</span>
                    )}
                  </Td>
                  <Td>{date(m.joined_on, lang)}{m.left_on ? ` → ${date(m.left_on, lang)}` : ''}</Td>
                  <Td align="right"><Money value={bal} colored /></Td>
                  {canEdit && (
                    <Td align="right">
                      {m.status !== 'left' && (
                        <div className="flex flex-wrap justify-end gap-1">
                          {m.status === 'trial' && (
                            <Button size="sm" variant="primary" disabled={activate.isPending}
                              onClick={async () => {
                                if (await confirm({ title: t('lc.m.activateQ', { name: m.students?.full_name }), message: t('lc.m.activateHint') })) {
                                  activate.mutate(m.id);
                                }
                              }}>
                              {t('lc.m.activate')}
                            </Button>
                          )}
                          {m.status === 'active' && (
                            <Button size="sm" onClick={() => setFreezing(m)}>{t('lc.m.freeze')}</Button>
                          )}
                          <Button size="sm" onClick={() => setMoving(m)}>{t('lc.m.transfer')}</Button>
                          <Button size="sm" variant="ghost" onClick={() => setLeaving(m)}>{t('lc.m.leave')}</Button>
                        </div>
                      )}
                    </Td>
                  )}
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}

      <AddMember open={adding} group={group} onClose={() => setAdding(false)} onDone={refresh} />
      <FreezeModal member={freezing} onClose={() => setFreezing(null)} onDone={refresh} />
      <LeaveModal member={leaving} onClose={() => setLeaving(null)} onDone={refresh} />
      <TransferModal member={moving} group={group} onClose={() => setMoving(null)} onDone={refresh} />
    </>
  );
}

function AddMember({ open, group, onClose, onDone }: {
  open: boolean; group: GroupRow; onClose: () => void; onDone: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const { profile } = useAuth();
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [q, setQ] = useState('');
  const [studentId, setStudentId] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [from, setFrom] = useState(isoDate());
  const [trial, setTrial] = useState(false);

  const found = useQuery({
    queryKey: ['lc-student-search', group.branch_id, q],
    enabled: open && mode === 'existing' && q.trim().length >= 2,
    queryFn: async () => {
      const needle = q.trim();
      const { data, error } = await supabase.from('students')
        .select('id, full_name, payment_code')
        .eq('branch_id', group.branch_id).is('deleted_at', null).eq('status', 'active')
        .or(`full_name.ilike.%${needle.replace(/[%,()]/g, '')}%,payment_code.ilike.%${needle.replace(/[%,()]/g, '')}%`)
        .order('full_name').limit(10);
      if (error) throw error;
      return data ?? [];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      let sid = studentId;
      if (mode === 'new') {
        const { data, error } = await supabase.from('students').insert({
          school_id: profile!.school_id,
          branch_id: group.branch_id,
          full_name: name.trim(),
          enrolled_on: from,
        }).select('id').single();
        if (error) throw error;
        sid = data.id;
        const digits = phone.replace(/\D/g, '');
        if (digits.length >= 9) {
          const { data: p } = await supabase.from('parents').insert({
            school_id: profile!.school_id, full_name: name.trim(), phone: digits,
          }).select('id').single();
          if (p) await supabase.from('student_parents').insert({ student_id: sid, parent_id: p.id, is_primary: true });
        }
      }
      const { error } = await supabase.rpc('enroll_to_group', {
        p_group_id: group.id, p_student_id: sid, p_from: from, p_trial: trial,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.ok(trial ? t('lc.m.addedTrial') : t('lc.m.added'));
      onDone();
      setQ(''); setStudentId(''); setName(''); setPhone(''); setTrial(false);
      onClose();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const ok = mode === 'existing' ? !!studentId : name.trim().length > 1;

  return (
    <Modal open={open} onClose={onClose} title={t('lc.m.add')}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={!ok || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? t('common.saving') : (trial ? t('lc.m.addTrial') : t('lc.m.addActive'))}
          </Button>
        </>
      }>
      <div className="mb-3 flex rounded-lg border p-0.5">
        {(['existing', 'new'] as const).map((x) => (
          <button key={x} type="button" onClick={() => setMode(x)}
            className={`flex-1 rounded-md px-2 py-1.5 text-[13px] font-medium ${mode === x
              ? 'bg-[var(--bg-inset)]' : 'text-[var(--text-muted)]'}`}>
            {t(`lc.m.${x}`)}
          </button>
        ))}
      </div>

      <div className="grid gap-3">
        {mode === 'existing' ? (
          <>
            <Field label={t('lc.m.search')}>
              <Input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setStudentId(''); }}
                     placeholder={t('lc.m.searchHint')} />
            </Field>
            {(found.data ?? []).length > 0 && (
              <ul className="max-h-56 divide-y overflow-y-auto rounded-lg border">
                {found.data!.map((s) => (
                  <li key={s.id}>
                    <button type="button" onClick={() => setStudentId(s.id)}
                      className={`flex w-full items-center justify-between px-3 py-2 text-left text-[13px]
                        ${studentId === s.id ? 'bg-[var(--sel-bg)] text-[var(--sel-text)]' : 'hover:bg-[var(--bg-subtle)]'}`}>
                      <span className="font-medium">{s.full_name}</span>
                      <span className="text-[11px] text-[var(--text-faint)]">{s.payment_code}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {q.trim().length >= 2 && !found.isLoading && (found.data ?? []).length === 0 && (
              <Notice tone="neutral">
                {t('lc.m.notFound')}{' '}
                <button type="button" className="underline" onClick={() => { setMode('new'); setName(q); }}>
                  {t('lc.m.createNew')}
                </button>
              </Notice>
            )}
          </>
        ) : (
          <>
            <Field label={t('lc.m.fullName')} required>
              <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={t('lc.m.parentPhone')}>
              <Input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+998" />
            </Field>
          </>
        )}

        <Field label={trial ? t('lc.m.trialDate') : t('lc.m.fromDate')} hint={trial ? undefined : t('lc.m.fromHint')}>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>

        <label className="flex items-start gap-2 rounded-lg border p-3 text-[13px]">
          <input type="checkbox" className="mt-0.5" checked={trial} onChange={(e) => setTrial(e.target.checked)} />
          <span>
            <span className="font-medium">{t('lc.m.trial')}</span>
            <span className="block text-[12px] text-[var(--text-muted)]">{t('lc.m.trialHint')}</span>
          </span>
        </label>
      </div>
    </Modal>
  );
}

// deno-lint-ignore no-explicit-any
function FreezeModal({ member, onClose, onDone }: { member: any; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const toast = useToast();
  const [from, setFrom] = useState(isoDate());
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('freeze_group_member', {
        p_member_id: member.id, p_from: from, p_to: to, p_reason: reason.trim() || undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.ok(t('lc.m.frozen')); onDone(); onClose(); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Modal open={!!member} onClose={onClose} title={t('lc.m.freezeTitle', { name: member?.students?.full_name ?? '' })}
      footer={<>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" disabled={!to || to < from || save.isPending} onClick={() => save.mutate()}>{t('lc.m.freeze')}</Button>
      </>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('lc.m.freezeFrom')}><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label={t('lc.m.freezeTo')}><Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
        <div className="sm:col-span-2">
          <Field label={t('lc.m.reason')}><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </div>
        <div className="sm:col-span-2"><Notice tone="neutral">{t('lc.m.freezeHint')}</Notice></div>
      </div>
    </Modal>
  );
}

// deno-lint-ignore no-explicit-any
function LeaveModal({ member, onClose, onDone }: { member: any; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const toast = useToast();
  const [on, setOn] = useState(isoDate());
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('leave_group', {
        p_member_id: member.id, p_on: on, p_reason: reason.trim() || undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.ok(t('lc.m.left')); onDone(); onClose(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const REASONS = ['price', 'schedule', 'teacher', 'moved', 'finished', 'other'];
  return (
    <Modal open={!!member} onClose={onClose} title={t('lc.m.leaveTitle', { name: member?.students?.full_name ?? '' })}
      footer={<>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="danger" disabled={save.isPending} onClick={() => save.mutate()}>{t('lc.m.leave')}</Button>
      </>}>
      <div className="grid gap-3">
        <Field label={t('lc.m.lastDay')} hint={t('lc.m.lastDayHint')}>
          <Input type="date" value={on} onChange={(e) => setOn(e.target.value)} />
        </Field>
        <Field label={t('lc.m.reason')}>
          <Select value={REASONS.includes(reason) ? reason : (reason ? 'other' : '')}
                  onChange={(e) => setReason(e.target.value === 'other' ? '' : t(`lc.reason.${e.target.value}`))}>
            <option value="">—</option>
            {REASONS.map((r) => <option key={r} value={r}>{t(`lc.reason.${r}`)}</option>)}
          </Select>
        </Field>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('lc.m.reasonFree')} />
      </div>
    </Modal>
  );
}

// deno-lint-ignore no-explicit-any
function TransferModal({ member, group, onClose, onDone }: { member: any; group: GroupRow; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const toast = useToast();
  const [to, setTo] = useState('');
  const [on, setOn] = useState(isoDate());
  const groups = useQuery({
    queryKey: ['lc-transfer-targets', group.branch_id],
    enabled: !!member,
    queryFn: async () => {
      const { data, error } = await supabase.from('study_groups').select('id, name, status')
        .eq('branch_id', group.branch_id).is('deleted_at', null).neq('status', 'finished').order('name');
      if (error) throw error;
      return (data ?? []).filter((x) => x.id !== group.id);
    },
  });
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('transfer_group_member', {
        p_member_id: member.id, p_to_group_id: to, p_on: on,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.ok(t('lc.m.moved')); onDone(); onClose(); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Modal open={!!member} onClose={onClose} title={t('lc.m.transferTitle', { name: member?.students?.full_name ?? '' })}
      footer={<>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" disabled={!to || save.isPending} onClick={() => save.mutate()}>{t('lc.m.transfer')}</Button>
      </>}>
      <div className="grid gap-3">
        <Field label={t('lc.m.toGroup')}>
          <Select value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">—</option>
            {(groups.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
        </Field>
        <Field label={t('lc.m.fromDate')} hint={t('lc.m.transferHint')}>
          <Input type="date" value={on} onChange={(e) => setOn(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------
//  DARSLAR
// ---------------------------------------------------------------------

function MonthNav({ month, setMonth }: { month: string; setMonth: (m: string) => void }) {
  const { lang } = useI18n();
  const shift = (n: number) => {
    const d = new Date(`${month}T00:00:00`);
    d.setMonth(d.getMonth() + n);
    setMonth(monthStart(isoDate(d)));
  };
  return (
    <div className="flex items-center gap-1">
      <Button size="sm" variant="ghost" onClick={() => shift(-1)} aria-label="prev">‹</Button>
      <span className="min-w-[8rem] text-center text-[13px] font-medium">{periodLabel(month, lang)}</span>
      <Button size="sm" variant="ghost" onClick={() => shift(1)} aria-label="next">›</Button>
    </div>
  );
}

function Lessons({ group }: { group: GroupRow }) {
  const t = useT();
  const { lang } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const { mayWrite } = useAuth();
  const [month, setMonth] = useState(monthStart());
  const [open, setOpen] = useState<SessionLite | null>(null);
  // deno-lint-ignore no-explicit-any
  const [cancelling, setCancelling] = useState<any>(null);
  const [extra, setExtra] = useState(false);

  const sessions = useQuery({
    queryKey: ['lc-sessions', group.id, month],
    queryFn: async () => {
      const { data, error } = await supabase.from('group_sessions')
        .select('id, day, start_time, end_time, status, topic, homework, cancel_reason, teacher_id, teachers(full_name)')
        .eq('group_id', group.id).gte('day', month).lte('day', monthEnd(month))
        .order('day').order('start_time');
      if (error) throw error;
      // deno-lint-ignore no-explicit-any
      return (data ?? []) as any[];
    },
  });

  const counts = useQuery({
    queryKey: ['lc-sessions-att', group.id, month, (sessions.data ?? []).length],
    enabled: (sessions.data ?? []).length > 0,
    queryFn: async () => {
      const ids = (sessions.data ?? []).map((s) => s.id);
      const { data, error } = await supabase.from('session_attendance').select('session_id, status').in('session_id', ids);
      if (error) throw error;
      const m = new Map<string, { p: number; a: number }>();
      for (const r of data ?? []) {
        const c = m.get(r.session_id) ?? { p: 0, a: 0 };
        if (r.status === 'present' || r.status === 'late') c.p++; else if (r.status === 'absent') c.a++;
        m.set(r.session_id, c);
      }
      return m;
    },
  });

  const generate = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('generate_group_sessions', {
        p_group_id: group.id, p_from: month, p_to: monthEnd(month),
      });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (n) => {
      toast.ok(t('lc.l.generated', { n }));
      qc.invalidateQueries({ queryKey: ['lc-sessions', group.id] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const today = isoDate();
  const canEdit = mayWrite('students.manage');
  const list = sessions.data ?? [];
  const held = list.filter((s) => s.status === 'held').length;
  const unmarked = list.filter((s) => s.status === 'planned' && s.day < today).length;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <MonthNav month={month} setMonth={setMonth} />
        <span className="text-[13px] text-[var(--text-muted)]">
          {t('lc.l.summary', { held, total: list.filter((s) => s.status !== 'cancelled').length })}
        </span>
        {unmarked > 0 && <Badge tone="warn">{t('lc.l.unmarked', { n: unmarked })}</Badge>}
        {canEdit && (
          <span className="ml-auto flex gap-2">
            <Button size="sm" onClick={() => setExtra(true)}>{t('lc.l.extra')}</Button>
            <Button size="sm" disabled={generate.isPending || group.days.length === 0} onClick={() => generate.mutate()}>
              {t('lc.l.generate')}
            </Button>
          </span>
        )}
      </div>

      {sessions.isLoading ? <Loading /> : list.length === 0 ? (
        <EmptyState title={t('lc.l.empty')} hint={group.days.length ? t('lc.l.emptyHint') : t('lc.l.noDays')} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t('common.date')}</Th>
              <Th>{t('lc.time')}</Th>
              <Th>{t('common.status')}</Th>
              <Th align="right">{t('lc.l.attendance')}</Th>
              <Th>{t('lc.att.topic')}</Th>
              {canEdit && <Th />}
            </tr>
          </thead>
          <tbody>
            {list.map((s) => {
              const c = counts.data?.get(s.id);
              const overdue = s.status === 'planned' && s.day < today;
              return (
                <Tr key={s.id} onClick={s.status !== 'cancelled' && s.day <= today
                  ? () => setOpen({ ...s, group_name: group.name }) : undefined}
                  className={s.day === today ? 'bg-[var(--sel-bg)]' : ''}>
                  <Td>{date(s.day, lang)} <span className="text-[12px] text-[var(--text-faint)]">{t(`lc.dowShort.${((new Date(`${s.day}T00:00:00`).getDay() + 6) % 7) + 1}`)}</span></Td>
                  <Td mono>{hhmm(s.start_time)}{s.end_time ? `–${hhmm(s.end_time)}` : ''}</Td>
                  <Td>
                    {s.status === 'held' && <Badge tone="ok">{t('lc.sstatus.held')}</Badge>}
                    {s.status === 'cancelled' && <Badge>{t('lc.sstatus.cancelled')}</Badge>}
                    {s.status === 'planned' && (overdue
                      ? <Badge tone="warn">{t('lc.sstatus.unmarked')}</Badge>
                      : <Badge tone="brand">{t('lc.sstatus.planned')}</Badge>)}
                    {s.teacher_id && s.teacher_id !== group.teacher_id && (
                      <span className="ml-1.5 text-[11px] text-[var(--text-muted)]">{t('lc.l.sub', { name: s.teachers?.full_name ?? '' })}</span>
                    )}
                  </Td>
                  <Td align="right" mono>{c ? `${c.p} / ${c.p + c.a}` : '—'}</Td>
                  <Td className="max-w-[16rem] truncate text-[13px] text-[var(--text-muted)]">
                    {s.status === 'cancelled' ? s.cancel_reason : s.topic}
                  </Td>
                  {canEdit && (
                    <Td align="right">
                      {s.status === 'planned' && (
                        <Button size="sm" variant="ghost"
                          onClick={(e) => { e.stopPropagation(); setCancelling(s); }}>
                          {t('lc.l.cancel')}
                        </Button>
                      )}
                    </Td>
                  )}
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}

      <SessionAttendance session={open} onClose={() => setOpen(null)} />
      <CancelSession session={cancelling} onClose={() => setCancelling(null)} />
      <ExtraSession open={extra} group={group} onClose={() => setExtra(false)} />
    </>
  );
}

// deno-lint-ignore no-explicit-any
function CancelSession({ session, onClose }: { session: any; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('cancel_session', { p_session_id: session.id, p_reason: reason.trim() });
      if (error) throw error;
    },
    onSuccess: () => { toast.ok(t('lc.l.cancelled')); qc.invalidateQueries({ queryKey: ['lc-sessions'] }); setReason(''); onClose(); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Modal open={!!session} onClose={onClose} title={t('lc.l.cancelTitle')}
      footer={<>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="danger" disabled={!reason.trim() || save.isPending} onClick={() => save.mutate()}>{t('lc.l.cancel')}</Button>
      </>}>
      <Field label={t('lc.m.reason')} hint={t('lc.l.cancelHint')}>
        <Input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Modal>
  );
}

function ExtraSession({ open, group, onClose }: { open: boolean; group: GroupRow; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const { profile } = useAuth();
  const [day, setDay] = useState(isoDate());
  const [start, setStart] = useState(hhmm(group.start_time));
  const [end, setEnd] = useState(hhmm(group.end_time));
  const save = useMutation({
    mutationFn: async (e: FormEvent) => {
      e.preventDefault();
      const { error } = await supabase.from('group_sessions').insert({
        school_id: profile!.school_id, branch_id: group.branch_id, group_id: group.id,
        day, start_time: start || null, end_time: end || null,
        teacher_id: group.teacher_id, room_id: group.room_id,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.ok(t('ux.saved')); qc.invalidateQueries({ queryKey: ['lc-sessions'] }); onClose(); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Modal open={open} onClose={onClose} title={t('lc.l.extra')}
      footer={<>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" type="submit" form="extra-form" disabled={save.isPending}>{t('common.save')}</Button>
      </>}>
      <form id="extra-form" onSubmit={(e) => save.mutate(e)} className="grid gap-3 sm:grid-cols-3">
        <Field label={t('common.date')}><Input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field>
        <Field label={t('lc.startTime')}><Input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label={t('lc.endTime')}><Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------
//  JURNAL
// ---------------------------------------------------------------------

const GLYPH: Record<string, string> = { present: '•', late: 'K', absent: '✕', excused: 'S' };
const GLYPH_COLOR: Record<string, string> = {
  present: 'text-[var(--ok)]', late: 'text-[var(--warn)]', absent: 'text-[var(--danger)]', excused: 'text-[var(--text-faint)]',
};

function Journal({ group }: { group: GroupRow }) {
  const t = useT();
  const [month, setMonth] = useState(monthStart());

  const data = useQuery({
    queryKey: ['lc-journal', group.id, month],
    queryFn: async () => {
      const { data: ss, error } = await supabase.from('group_sessions')
        .select('id, day, status').eq('group_id', group.id)
        .gte('day', month).lte('day', monthEnd(month)).neq('status', 'cancelled').order('day');
      if (error) throw error;
      const ids = (ss ?? []).map((s) => s.id);
      const att = ids.length ? (await supabase.from('session_attendance')
        .select('session_id, student_id, status, grade').in('session_id', ids)).data ?? [] : [];
      const { data: ms } = await supabase.from('group_members')
        .select('student_id, status, joined_on, left_on, students(full_name)')
        .eq('group_id', group.id).lte('joined_on', monthEnd(month));
      // deno-lint-ignore no-explicit-any
      const members = ((ms ?? []) as any[]).filter((m) => !m.left_on || m.left_on >= month)
        .sort((a, b) => (a.students?.full_name ?? '').localeCompare(b.students?.full_name ?? ''));
      const cell = new Map<string, { status: string; grade: number | null }>(
        att.map((a) => [`${a.student_id}:${a.session_id}`, a] as const));
      return { sessions: ss ?? [], members, cell };
    },
  });

  const stats = useMemo(() => {
    const d = data.data;
    if (!d) return new Map<string, { rate: number | null; avg: number | null }>();
    const m = new Map<string, { rate: number | null; avg: number | null }>();
    for (const mem of d.members) {
      let p = 0, n = 0, gs = 0, gn = 0;
      for (const s of d.sessions) {
        const a = d.cell.get(`${mem.student_id}:${s.id}`);
        if (!a) continue;
        n++;
        if (a.status === 'present' || a.status === 'late') p++;
        if (a.grade != null) { gs += a.grade; gn++; }
      }
      m.set(mem.student_id, { rate: n ? Math.round((100 * p) / n) : null, avg: gn ? Math.round(gs / gn) : null });
    }
    return m;
  }, [data.data]);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <MonthNav month={month} setMonth={setMonth} />
        <span className="text-[12px] text-[var(--text-muted)]">
          • {t('lc.mark.present')} · K {t('lc.mark.late')} · ✕ {t('lc.mark.absent')} · S {t('lc.mark.excused')}
        </span>
      </div>
      {data.isLoading ? <Loading /> : !data.data || data.data.members.length === 0 ? (
        <EmptyState />
      ) : (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 border-b bg-[var(--bg-subtle)] px-3 py-2 text-left font-semibold">{t('lc.student')}</th>
                  {data.data.sessions.map((s) => (
                    <th key={s.id} className="border-b bg-[var(--bg-subtle)] px-1.5 py-2 text-center font-medium num">
                      {s.day.slice(8, 10)}
                    </th>
                  ))}
                  <th className="border-b bg-[var(--bg-subtle)] px-2 py-2 text-right">%</th>
                  <th className="border-b bg-[var(--bg-subtle)] px-2 py-2 text-right">{t('lc.att.avg')}</th>
                </tr>
              </thead>
              <tbody>
                {data.data.members.map((m) => {
                  const st = stats.get(m.student_id);
                  return (
                    <tr key={m.student_id} className="hover:bg-[var(--bg-subtle)]">
                      <td className="sticky left-0 border-b border-[var(--border-soft)] bg-[var(--bg)] px-3 py-1.5 whitespace-nowrap">
                        {m.students?.full_name}
                        {m.status === 'trial' && <span className="ml-1 text-[10px] text-[var(--warn)]">{t('lc.trialShort')}</span>}
                      </td>
                      {data.data!.sessions.map((s) => {
                        const a = data.data!.cell.get(`${m.student_id}:${s.id}`);
                        return (
                          <td key={s.id} className="border-b border-[var(--border-soft)] px-1.5 py-1.5 text-center">
                            {a ? (
                              <span className={`font-semibold ${GLYPH_COLOR[a.status]}`} title={t(`lc.mark.${a.status}`)}>
                                {a.grade != null ? a.grade : GLYPH[a.status]}
                              </span>
                            ) : <span className="text-[var(--text-faint)]">·</span>}
                          </td>
                        );
                      })}
                      <td className={`num border-b border-[var(--border-soft)] px-2 text-right ${st?.rate != null && st.rate < 70 ? 'text-[var(--danger)]' : ''}`}>
                        {st?.rate ?? '—'}
                      </td>
                      <td className="num border-b border-[var(--border-soft)] px-2 text-right">{st?.avg ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
