// =====================================================================
//  Sotuv voronkasi (Kanban) — o'quv markazi uchun.
//
//  Yangi → Bog'lanildi → Sinov darsi → O'qishga yozildi / Rad etdi.
//  Kartochka sudrab boshqa ustunga o'tkaziladi (telefonda — tugma).
//  "Guruhga yozish" bitta oynada: o'quvchi kartochkasi, ota-ona va
//  guruh a'zoligi (sinov yoki faol) yaratiladi — qayta kiritish yo'q.
// =====================================================================

import { type DragEvent, type FormEvent, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n, useT } from '@/i18n';
import { date, isoDate } from '@/lib/format';
import { useCourses, useGroups } from '@/lib/lc';
import {
  Badge, Button, ErrorState, Field, Input, Loading, Modal, Notice, PageHeader, Select,
} from '@/ui';
import { formatPhone, PhoneInput } from '@/ui/PhoneInput';
import { useToast } from '@/ui/Feedback';
import { CatalogSelect } from '@/ui/CatalogSelect';

type Status = 'new' | 'contacted' | 'visited' | 'accepted' | 'rejected';
const COLS: Status[] = ['new', 'contacted', 'visited', 'accepted', 'rejected'];
const COL_TONE: Record<Status, string> = {
  new: 'bg-blue-500', contacted: 'bg-amber-500', visited: 'bg-violet-500',
  accepted: 'bg-emerald-500', rejected: 'bg-slate-400',
};

interface Lead {
  id: string;
  branch_id: string;
  full_name: string;
  phone: string;
  source: string | null;
  status: Status;
  next_contact_on: string | null;
  note: string | null;
  student_id: string | null;
  course_id: string | null;
  group_id: string | null;
  trial_on: string | null;
  lost_reason: string | null;
  created_at: string;
}

export default function LeadsFunnel() {
  const t = useT();
  const { lang } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const { branchId, can, mayWrite } = useAuth();
  const courses = useCourses();
  const groups = useGroups(branchId);

  const [q, setQ] = useState('');
  const [course, setCourse] = useState('');
  const [editing, setEditing] = useState<Partial<Lead> | null>(null);
  const [enrolling, setEnrolling] = useState<Lead | null>(null);
  const [losing, setLosing] = useState<Lead | null>(null);
  const [dragOver, setDragOver] = useState<Status | null>(null);
  const [mobileCol, setMobileCol] = useState<Status>('new');

  const rows = useQuery({
    queryKey: ['leads-funnel', branchId],
    queryFn: async () => {
      // Yopilganlar faqat oxirgi 60 kun — eski arxiv voronkani to'ldirmasin.
      const since = new Date();
      since.setDate(since.getDate() - 60);
      let qq = supabase.from('leads')
        .select('id, branch_id, full_name, phone, source, status, next_contact_on, note, student_id, course_id, group_id, trial_on, lost_reason, created_at')
        .or(`status.in.(new,contacted,visited),updated_at.gte.${since.toISOString()}`)
        .order('created_at', { ascending: false }).limit(500);
      if (branchId) qq = qq.eq('branch_id', branchId);
      const { data, error } = await qq;
      if (error) throw error;
      return (data ?? []) as Lead[];
    },
  });

  const move = useMutation({
    mutationFn: async (v: { id: string; status: Status; lost_reason?: string }) => {
      const { error } = await supabase.from('leads').update({
        status: v.status, ...(v.lost_reason !== undefined ? { lost_reason: v.lost_reason } : {}),
      }).eq('id', v.id);
      if (error) throw error;
    },
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ['leads-funnel', branchId] });
      const prev = qc.getQueryData<Lead[]>(['leads-funnel', branchId]);
      qc.setQueryData<Lead[]>(['leads-funnel', branchId], (old) =>
        (old ?? []).map((l) => (l.id === v.id ? { ...l, status: v.status } : l)));
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['leads-funnel', branchId], ctx.prev);
      toast.error((e as Error).message);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['leads-funnel'] }),
  });

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const digits = needle.replace(/\D/g, '');
    return (rows.data ?? []).filter((l) =>
      (!course || l.course_id === course) &&
      (!needle || l.full_name.toLowerCase().includes(needle) || (digits.length >= 3 && l.phone.includes(digits))));
  }, [rows.data, q, course]);

  const byCol = useMemo(() => {
    const m = new Map<Status, Lead[]>(COLS.map((c) => [c, []]));
    for (const l of filtered) m.get(l.status)?.push(l);
    return m;
  }, [filtered]);

  const conv = useMemo(() => {
    const all = rows.data ?? [];
    const closed = all.filter((l) => l.status === 'accepted' || l.status === 'rejected').length;
    const won = all.filter((l) => l.status === 'accepted').length;
    return closed ? Math.round((100 * won) / closed) : null;
  }, [rows.data]);

  if (!can('leads.manage')) return <Notice tone="danger">{t('common.noAccess')}</Notice>;
  if (rows.isLoading) return <Loading />;
  if (rows.error) return <ErrorState message={(rows.error as Error).message} onRetry={() => rows.refetch()} />;

  const canEdit = mayWrite('leads.manage');
  const today = isoDate();

  const drop = (status: Status) => (e: DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData('text/plain');
    const lead = (rows.data ?? []).find((l) => l.id === id);
    if (!lead || lead.status === status) return;
    changeTo(lead, status);
  };

  const changeTo = (lead: Lead, status: Status) => {
    if (status === 'rejected') { setLosing(lead); return; }
    if (status === 'accepted' && !lead.student_id) { setEnrolling(lead); return; }
    move.mutate({ id: lead.id, status });
  };

  const card = (l: Lead) => {
    const due = l.next_contact_on && l.next_contact_on <= today && (l.status === 'new' || l.status === 'contacted' || l.status === 'visited');
    const c = (courses.data ?? []).find((x) => x.id === l.course_id);
    return (
      <div key={l.id} draggable={canEdit}
        onDragStart={(e) => { e.dataTransfer.setData('text/plain', l.id); e.dataTransfer.effectAllowed = 'move'; }}
        className="group rounded-lg border bg-[var(--bg)] p-2.5 shadow-sm transition-shadow hover:shadow-md">
        <div className="flex items-start justify-between gap-2">
          <button type="button" className="min-w-0 text-left" onClick={() => setEditing(l)}>
            <div className="truncate text-[13px] font-semibold">{l.full_name}</div>
            <a href={`tel:+${l.phone}`} onClick={(e) => e.stopPropagation()}
               className="num text-[12px] text-brand-600 hover:underline dark:text-accent-400">{formatPhone(l.phone)}</a>
          </button>
          {due && <Badge tone="warn">{t('lc.f.callToday')}</Badge>}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1 text-[11px]">
          {c && <span className="rounded bg-[var(--bg-inset)] px-1.5 py-0.5">{c.name}</span>}
          {l.source && <span className="rounded bg-[var(--bg-inset)] px-1.5 py-0.5 text-[var(--text-muted)]">{l.source}</span>}
          {l.trial_on && (
            <span className={`rounded px-1.5 py-0.5 ${l.trial_on === today ? 'bg-[var(--warn-bg)] text-[var(--warn)]' : 'bg-[var(--bg-inset)]'}`}>
              {t('lc.f.trialOn', { d: date(l.trial_on, lang) })}
            </span>
          )}
          {l.next_contact_on && !l.trial_on && l.status !== 'accepted' && l.status !== 'rejected' && (
            <span className="rounded bg-[var(--bg-inset)] px-1.5 py-0.5 text-[var(--text-muted)]">
              ☎ {date(l.next_contact_on, lang)}
            </span>
          )}
        </div>
        {l.status === 'rejected' && l.lost_reason && (
          <div className="mt-1 text-[11px] text-[var(--text-muted)]">{l.lost_reason}</div>
        )}
        {canEdit && (
          <div className="mt-2 flex flex-wrap items-center gap-1">
            {l.student_id ? (
              <Link to={`/oquvchilar/${l.student_id}`} className="text-[12px] text-brand-600 hover:underline dark:text-accent-400">
                {t('lc.f.openStudent')}
              </Link>
            ) : l.status !== 'rejected' && (
              <Button size="sm" variant="primary" onClick={() => setEnrolling(l)}>{t('lc.f.enroll')}</Button>
            )}
            <Select value={l.status} onChange={(e) => changeTo(l, e.target.value as Status)}
                    className="ml-auto h-7 w-auto py-0 text-[12px]" aria-label={t('common.status')}>
              {COLS.map((s) => <option key={s} value={s}>{t(`lc.f.col.${s}`)}</option>)}
            </Select>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <PageHeader
        title={t('lc.f.title')}
        subtitle={[
          t('lc.f.open', { n: (byCol.get('new')?.length ?? 0) + (byCol.get('contacted')?.length ?? 0) + (byCol.get('visited')?.length ?? 0) }),
          conv !== null ? t('lc.f.conversion', { p: conv }) : null,
        ].filter(Boolean).join(' · ')}
        actions={canEdit && <Button variant="primary" onClick={() => setEditing({})}>{t('lead.add')}</Button>}
      />

      <div className="mb-3 flex flex-wrap gap-2">
        <Input placeholder={t('lc.f.search')} value={q} onChange={(e) => setQ(e.target.value)} className="w-auto min-w-[14rem] flex-1 sm:flex-none" />
        <Select value={course} onChange={(e) => setCourse(e.target.value)} className="w-auto min-w-[10rem]">
          <option value="">{t('lc.allCourses')}</option>
          {(courses.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </div>

      {/* Telefon: ustun tanlagich */}
      <div className="mb-2 flex gap-1 overflow-x-auto md:hidden">
        {COLS.map((c) => (
          <button key={c} type="button" onClick={() => setMobileCol(c)}
            className={`shrink-0 rounded-full border px-3 py-1 text-[12px] font-medium ${mobileCol === c
              ? 'border-[var(--sel-border)] bg-[var(--sel-bg)] text-[var(--sel-text)]' : 'text-[var(--text-muted)]'}`}>
            {t(`lc.f.col.${c}`)} <span className="opacity-60">{byCol.get(c)?.length ?? 0}</span>
          </button>
        ))}
      </div>
      <div className="space-y-2 md:hidden">
        {(byCol.get(mobileCol) ?? []).map(card)}
      </div>

      <div className="hidden gap-3 overflow-x-auto pb-2 md:grid" style={{ gridTemplateColumns: 'repeat(5, minmax(15rem, 1fr))' }}>
        {COLS.map((c) => (
          <section key={c}
            onDragOver={(e) => { if (canEdit) { e.preventDefault(); setDragOver(c); } }}
            onDragLeave={() => setDragOver((v) => (v === c ? null : v))}
            onDrop={drop(c)}
            className={`flex min-h-[60vh] flex-col rounded-xl border bg-[var(--bg-subtle)] transition-colors
              ${dragOver === c ? 'border-brand-500 bg-[var(--sel-bg)]' : ''}`}>
            <header className="flex items-center gap-2 px-3 py-2">
              <span className={`h-2 w-2 rounded-full ${COL_TONE[c]}`} />
              <span className="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{t(`lc.f.col.${c}`)}</span>
              <span className="ml-auto num text-[12px] text-[var(--text-faint)]">{byCol.get(c)?.length ?? 0}</span>
            </header>
            <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
              {(byCol.get(c) ?? []).map(card)}
            </div>
          </section>
        ))}
      </div>

      <LeadModal lead={editing} onClose={() => setEditing(null)} courses={courses.data ?? []} />
      <EnrollModal lead={enrolling} onClose={() => setEnrolling(null)} groups={groups.data ?? []} />
      <LostModal lead={losing} onClose={() => setLosing(null)}
        onSave={(reason) => { if (losing) move.mutate({ id: losing.id, status: 'rejected', lost_reason: reason }); setLosing(null); }} />
    </>
  );
}

// deno-lint-ignore no-explicit-any
function LeadModal({ lead, onClose, courses }: { lead: Partial<Lead> | null; onClose: () => void; courses: any[] }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const { profile, branches, branchId } = useAuth();
  const [f, setF] = useState({ full_name: '', phone: '', source: '', course_id: '', next_contact_on: '', trial_on: '', note: '', branch_id: '' });

  useEffect(() => {
    if (!lead) return;
    setF({
      full_name: lead.full_name ?? '', phone: lead.phone ?? '', source: lead.source ?? '',
      course_id: lead.course_id ?? '', next_contact_on: lead.next_contact_on ?? '',
      trial_on: lead.trial_on ?? '', note: lead.note ?? '',
      branch_id: lead.branch_id ?? branchId ?? branches[0]?.id ?? '',
    });
  }, [lead, branchId, branches]);

  const save = useMutation({
    mutationFn: async (e: FormEvent) => {
      e.preventDefault();
      const payload = {
        full_name: f.full_name.trim(), phone: f.phone.replace(/\D/g, ''),
        source: f.source.trim() || null, course_id: f.course_id || null,
        next_contact_on: f.next_contact_on || null, trial_on: f.trial_on || null,
        note: f.note.trim() || null,
        // Sinov sanasi qo'yilsa — kartochka "Sinov darsi" ustuniga o'tadi.
        ...(f.trial_on && (!lead?.status || lead.status === 'new' || lead.status === 'contacted') ? { status: 'visited' as const } : {}),
      };
      const { error } = lead?.id
        ? await supabase.from('leads').update(payload).eq('id', lead.id)
        : await supabase.from('leads').insert({ school_id: profile!.school_id, branch_id: f.branch_id, created_by: profile!.id, ...payload });
      if (error) throw error;
    },
    onSuccess: () => { toast.ok(t('ux.saved')); qc.invalidateQueries({ queryKey: ['leads-funnel'] }); qc.invalidateQueries({ queryKey: ['leads'] }); onClose(); },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <Modal open={!!lead} onClose={onClose} title={lead?.id ? t('lc.f.edit') : t('lead.add')}
      footer={<>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" type="submit" form="lead-lc-form"
                disabled={!f.full_name.trim() || f.phone.replace(/\D/g, '').length < 9 || save.isPending}>{t('common.save')}</Button>
      </>}>
      <form id="lead-lc-form" onSubmit={(e) => save.mutate(e)} className="grid gap-3 sm:grid-cols-2">
        {!lead?.id && branches.length > 1 && (
          <Field label={t('common.branch')}>
            <Select value={f.branch_id} onChange={(e) => setF({ ...f, branch_id: e.target.value })}>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </Field>
        )}
        <Field label={t('lc.f.name')} required>
          <Input autoFocus value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} />
        </Field>
        <Field label={t('common.phone')} required>
          <PhoneInput value={f.phone} onChange={(v) => setF({ ...f, phone: v })} required />
        </Field>
        <Field label={t('lc.course')}>
          <Select value={f.course_id} onChange={(e) => setF({ ...f, course_id: e.target.value })}>
            <option value="">—</option>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.name}{c.level ? ` · ${c.level}` : ''}</option>)}
          </Select>
        </Field>
        <CatalogSelect kind="lead_source" label={t('lead.source')} value={f.source} onChange={(v) => setF({ ...f, source: v })} />
        <Field label={t('lc.f.nextContact')}>
          <Input type="date" value={f.next_contact_on} onChange={(e) => setF({ ...f, next_contact_on: e.target.value })} />
        </Field>
        <Field label={t('lc.f.trialDate')} hint={t('lc.f.trialHint')}>
          <Input type="date" value={f.trial_on} onChange={(e) => setF({ ...f, trial_on: e.target.value })} />
        </Field>
        <div className="sm:col-span-2">
          <Field label={t('common.note')}>
            <Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          </Field>
        </div>
      </form>
    </Modal>
  );
}

// deno-lint-ignore no-explicit-any
function EnrollModal({ lead, onClose, groups }: { lead: Lead | null; onClose: () => void; groups: any[] }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const { profile } = useAuth();
  const [groupId, setGroupId] = useState('');
  const [trial, setTrial] = useState(false);
  const [from, setFrom] = useState(isoDate());
  const [studentName, setStudentName] = useState('');

  useEffect(() => {
    if (!lead) return;
    setStudentName(lead.full_name);
    setTrial(!lead.trial_on || lead.status !== 'visited');
    setFrom(lead.trial_on && lead.trial_on >= isoDate() ? lead.trial_on : isoDate());
    const match = groups.find((g) => g.id === lead.group_id)
      ?? groups.find((g) => g.course_id && g.course_id === lead.course_id && g.status !== 'finished');
    setGroupId(match?.id ?? '');
  }, [lead, groups]);

  const options = groups.filter((g) => g.status !== 'finished' && (!lead || g.branch_id === lead.branch_id));

  const save = useMutation({
    mutationFn: async () => {
      const l = lead!;
      const { data: st, error } = await supabase.from('students').insert({
        school_id: profile!.school_id, branch_id: l.branch_id,
        full_name: studentName.trim(), enrolled_on: from,
      }).select('id').single();
      if (error) throw error;

      const phone = l.phone.replace(/\D/g, '');
      if (phone.length >= 9) {
        const { data: existing } = await supabase.from('parents').select('id').eq('phone', phone).maybeSingle();
        let parentId = existing?.id;
        if (!parentId) {
          const { data: p } = await supabase.from('parents')
            .insert({ school_id: profile!.school_id, full_name: l.full_name, phone }).select('id').single();
          parentId = p?.id;
        }
        if (parentId) await supabase.from('student_parents').insert({ student_id: st.id, parent_id: parentId, is_primary: true });
      }

      const { error: eErr } = await supabase.rpc('enroll_to_group', {
        p_group_id: groupId, p_student_id: st.id, p_from: from, p_trial: trial,
      });
      if (eErr) throw eErr;

      const { error: uErr } = await supabase.from('leads').update({
        student_id: st.id, group_id: groupId,
        status: trial ? 'visited' : 'accepted',
        ...(trial ? { trial_on: from } : {}),
      }).eq('id', l.id);
      if (uErr) throw uErr;
    },
    onSuccess: () => {
      toast.ok(trial ? t('lc.m.addedTrial') : t('lc.m.added'));
      qc.invalidateQueries({ queryKey: ['leads-funnel'] });
      qc.invalidateQueries({ queryKey: ['lc-member-counts'] });
      qc.invalidateQueries({ queryKey: ['students'] });
      onClose();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <Modal open={!!lead} onClose={onClose} title={t('lc.f.enrollTitle', { name: lead?.full_name ?? '' })}
      footer={<>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" disabled={!groupId || !studentName.trim() || save.isPending} onClick={() => save.mutate()}>
          {trial ? t('lc.m.addTrial') : t('lc.m.addActive')}
        </Button>
      </>}>
      <div className="grid gap-3">
        <Field label={t('lc.f.studentName')} hint={t('lc.f.studentNameHint')}>
          <Input value={studentName} onChange={(e) => setStudentName(e.target.value)} />
        </Field>
        <Field label={t('lc.group.one')} required>
          <Select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">—</option>
            {options.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </Select>
        </Field>
        <Field label={trial ? t('lc.m.trialDate') : t('lc.m.fromDate')}>
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

function LostModal({ lead, onClose, onSave }: { lead: Lead | null; onClose: () => void; onSave: (r: string) => void }) {
  const t = useT();
  const [reason, setReason] = useState('');
  const REASONS = ['price', 'schedule', 'noAnswer', 'competitor', 'notNow', 'other'];
  useEffect(() => { setReason(''); }, [lead]);
  return (
    <Modal open={!!lead} onClose={onClose} title={t('lc.f.lostTitle', { name: lead?.full_name ?? '' })}
      footer={<>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="danger" onClick={() => onSave(reason)}>{t('lc.f.markLost')}</Button>
      </>}>
      <div className="flex flex-wrap gap-1.5">
        {REASONS.map((r) => (
          <button key={r} type="button" onClick={() => setReason(t(`lc.lost.${r}`))}
            className={`rounded-full border px-3 py-1 text-[12px] ${reason === t(`lc.lost.${r}`)
              ? 'border-[var(--sel-border)] bg-[var(--sel-bg)] text-[var(--sel-text)]' : 'hover:bg-[var(--bg-inset)]'}`}>
            {t(`lc.lost.${r}`)}
          </button>
        ))}
      </div>
      <Input className="mt-3" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('lc.m.reasonFree')} />
      <p className="mt-2 text-[12px] text-[var(--text-muted)]">{t('lc.f.lostHint')}</p>
    </Modal>
  );
}
