// =====================================================================
//  Murojaatlar (TZ 4.2).
//
//  Maqsad: maktabga qiziqib murojaat qilgan ota-onalarni yo'qotmaslik.
//
//  TZ 4.2.2 — "Bugun bog'lanish kerak" filtri.
//  TZ 4.2.3 — `Qabul qilindi` belgilanganda murojaat ma'lumotlari
//             asosida o'quvchi kartochkasi AVTOMATIK yaratiladi,
//             ma'lumot qayta kiritilmaydi.
//  TZ 4.2.4 — har bir holat o'zgarishi kim va qachon qilgani bilan
//             qayd etiladi (baza triggeri o'zi yozadi).
// =====================================================================

import { type FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n, useT } from '@/i18n';
import { date, isoDate } from '@/lib/format';
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Input, Loading,
  Modal, Notice, PageHeader, Select, Table, Td, Th, Tr,
} from '@/ui';
import { useToast } from '@/ui/Feedback';
import { CatalogSelect } from '@/ui/CatalogSelect';
import { ClassPicker, useClassOptions } from '@/ui/ClassPicker';

type Status = 'new' | 'contacted' | 'visited' | 'accepted' | 'rejected';

const FLOW: Status[] = ['new', 'contacted', 'visited', 'accepted', 'rejected'];

const TONE: Record<Status, 'brand' | 'warn' | 'ok' | 'neutral'> = {
  new: 'brand',
  contacted: 'warn',
  visited: 'warn',
  accepted: 'ok',
  rejected: 'neutral',
};

export default function Leads() {
  const t = useT();
  const { lang } = useI18n();
  const qc = useQueryClient();
  const { branchId, branches, can, mayWrite, profile } = useAuth();

  const [status, setStatus] = useState<Status | ''>('');
  const [todayOnly, setTodayOnly] = useState(false);
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  // deno-lint-ignore no-explicit-any
  const [editing, setEditing] = useState<any>(null);
  const [converting, setConverting] = useState<Record<string, unknown> | null>(null);

  const rows = useQuery({
    queryKey: ['leads', branchId, status],
    queryFn: async () => {
      let q = supabase
        .from('leads')
        .select('id, full_name, phone, target_class, source, status, next_contact_on, note, student_id, created_at, branch_id')
        .order('created_at', { ascending: false })
        .limit(300);
      if (branchId) q = q.eq('branch_id', branchId);
      if (status) q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const list = useMemo(() => {
    const today = isoDate();
    return (rows.data ?? []).filter((l) => {
      if (!todayOnly) return true;
      // TZ 4.2.2 — bugun yoki kechikkanlar.
      return !!l.next_contact_on && l.next_contact_on <= today &&
        !['accepted', 'rejected'].includes(l.status);
    });
  }, [rows.data, todayOnly]);

  const todayCount = useMemo(() => {
    const today = isoDate();
    return (rows.data ?? []).filter((l) =>
      !!l.next_contact_on && l.next_contact_on <= today &&
      !['accepted', 'rejected'].includes(l.status)).length;
  }, [rows.data]);

  const save = useMutation({
    // deno-lint-ignore no-explicit-any
    mutationFn: async (f: any) => {
      const payload = {
        full_name: f.full_name.trim(),
        phone: f.phone.replace(/\D/g, ''),
        target_class: f.target_class.trim() || null,
        source: f.source.trim() || null,
        next_contact_on: f.next_contact_on || null,
        note: f.note.trim() || null,
      };
      if (f.id) {
        const { error } = await supabase.from('leads')
          .update(payload).eq('id', f.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('leads').insert({
          school_id: profile!.school_id,
          branch_id: f.branch_id,
          ...payload,
          created_by: profile!.id,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      toast.ok(t('ux.saved'));
      setAdding(false);
      setEditing(null);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const changeStatus = useMutation({
    mutationFn: async (v: { id: string; status: Status }) => {
      const { error } = await supabase
        .from('leads')
        .update({ status: v.status })
        .eq('id', v.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  });

  // TZ 4.2.3 — qabul qilinganda o'quvchi kartochkasi yaratiladi.
  const convert = useMutation({
    // deno-lint-ignore no-explicit-any
    mutationFn: async (v: { lead: any; classId: string | null }) => {
      // `class_name` yozilmaydi — uni `class_id` bo'yicha trigger
      // to'ldiradi, shunda sinf nomi bir manbadan keladi.
      const { data: st, error } = await supabase.from('students').insert({
        school_id: profile!.school_id,
        branch_id: v.lead.branch_id,
        full_name: v.lead.full_name,
        class_id: v.classId,
        enrolled_on: isoDate(),
      }).select('id').single();
      if (error) throw error;

      // Ota-ona ma'lumoti ham ko'chiriladi — qayta kiritilmasin.
      const phone = String(v.lead.phone ?? '').replace(/\D/g, '');
      if (phone.length >= 9) {
        const { data: existing } = await supabase
          .from('parents').select('id').eq('phone', phone).maybeSingle();

        let parentId = existing?.id;
        if (!parentId) {
          const { data: p } = await supabase.from('parents').insert({
            school_id: profile!.school_id,
            full_name: v.lead.full_name,
            phone,
          }).select('id').single();
          parentId = p?.id;
        }
        if (parentId) {
          await supabase.from('student_parents').insert({
            student_id: st.id, parent_id: parentId, is_primary: true,
          });
        }
      }

      const { error: uErr } = await supabase
        .from('leads')
        .update({ status: 'accepted', student_id: st.id })
        .eq('id', v.lead.id);
      if (uErr) throw uErr;

      return st.id as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['students'] });
      setConverting(null);
    },
  });

  if (!can('leads.manage')) {
    return <Notice tone="danger">{t('common.noAccess')}</Notice>;
  }
  if (rows.isLoading) return <Loading />;
  if (rows.error) {
    return <ErrorState message={(rows.error as Error).message}
                       onRetry={() => rows.refetch()} />;
  }

  return (
    <>
      <PageHeader
        title={t('lead.title')}
        subtitle={t('common.showing', { count: list.length })}
        actions={mayWrite('leads.manage') && (
          <Button variant="primary" onClick={() => setAdding(true)}>
            {t('lead.add')}
          </Button>
        )}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select value={status} onChange={(e) => setStatus(e.target.value as Status | '')}
                className="w-auto min-w-[10rem]">
          <option value="">{t('common.all')}</option>
          {FLOW.map((s) => (
            <option key={s} value={s}>{t(`lead.status.${s}`)}</option>
          ))}
        </Select>

        <button
          type="button"
          onClick={() => setTodayOnly((v) => !v)}
          className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5
            text-[13px] font-medium transition-colors
            ${todayOnly
              ? 'border-[var(--sel-border)] bg-[var(--sel-bg)] text-[var(--sel-text)]'
              : 'hover:bg-[var(--bg-inset)]'}`}
        >
          {t('lead.today')}
          {todayCount > 0 && <Badge tone="warn">{todayCount}</Badge>}
        </button>
      </div>

      <Card padded={false}>
        {list.length === 0 ? <EmptyState /> : (
          <Table>
            <thead>
              <tr>
                <Th>{t('common.fullName')}</Th>
                <Th>{t('common.phone')}</Th>
                <Th>{t('lead.targetClass')}</Th>
                <Th>{t('lead.source')}</Th>
                <Th>{t('lead.nextContact')}</Th>
                <Th>{t('common.status')}</Th>
                <Th align="right">{t('common.actions')}</Th>
              </tr>
            </thead>
            <tbody>
              {list.map((l) => {
                const overdue = !!l.next_contact_on &&
                  l.next_contact_on <= isoDate() &&
                  !['accepted', 'rejected'].includes(l.status);
                return (
                  <Tr key={l.id}>
                    <Td className="font-medium">{l.full_name}</Td>
                    <Td mono className="text-[var(--text-muted)]">{l.phone}</Td>
                    <Td className="text-[var(--text-muted)]">
                      {l.target_class ?? '—'}
                    </Td>
                    <Td className="text-[var(--text-muted)]">{l.source ?? '—'}</Td>
                    <Td mono>
                      {l.next_contact_on
                        ? (
                          <span className={overdue ? 'text-[var(--danger)]' : ''}>
                            {date(l.next_contact_on, lang)}
                          </span>
                        )
                        : '—'}
                    </Td>
                    <Td>
                      <Badge tone={TONE[l.status as Status]}>
                        {t(`lead.status.${l.status}`)}
                      </Badge>
                    </Td>
                    <Td align="right">
                      {l.student_id
                        ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <Link to={`/oquvchilar/${l.student_id}`}
                                  className="text-[13px] text-brand-600
                                    hover:underline">
                              {t('lead.converted')}
                            </Link>
                            {mayWrite('leads.manage') && (
                              <Button size="sm" variant="ghost"
                                      onClick={() => setEditing(l)}>
                                {t('common.edit')}
                              </Button>
                            )}
                          </div>
                        )
                        : mayWrite('leads.manage') && (
                          <div className="flex justify-end gap-1.5">
                            <Select
                              value={l.status}
                              onChange={(e) => changeStatus.mutate({
                                id: l.id, status: e.target.value as Status,
                              })}
                              className="w-auto !h-7 text-[12px]"
                            >
                              {FLOW.map((s) => (
                                <option key={s} value={s}>
                                  {t(`lead.status.${s}`)}
                                </option>
                              ))}
                            </Select>
                            <Button size="sm" variant="ghost"
                                    onClick={() => setEditing(l)}>
                              {t('common.edit')}
                            </Button>
                            <Button size="sm" variant="accent"
                                    onClick={() => setConverting(l)}>
                              {t('lead.convert')}
                            </Button>
                          </div>
                        )}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {(adding || editing) && (
        <LeadModal
          key={editing?.id ?? 'new'}
          existing={editing}
          onClose={() => { setAdding(false); setEditing(null); }}
          branches={branches}
          defaultBranch={branchId ?? branches[0]?.id ?? ''}
          onSubmit={(f) => save.mutate(f)}
          busy={save.isPending}
          error={save.error ? (save.error as Error).message : null}
        />
      )}

      <ConvertModal
        lead={converting}
        onClose={() => setConverting(null)}
        onSubmit={(classId) =>
          convert.mutate({ lead: converting, classId })}
        busy={convert.isPending}
        error={convert.error ? (convert.error as Error).message : null}
      />
    </>
  );
}

// ---------------------------------------------------------------------

function LeadModal({
  existing, onClose, branches, defaultBranch, onSubmit, busy, error,
}: {
  // deno-lint-ignore no-explicit-any
  existing: any;
  onClose: () => void;
  branches: Array<{ id: string; name: string }>;
  defaultBranch: string;
  // deno-lint-ignore no-explicit-any
  onSubmit: (f: any) => void;
  busy: boolean;
  error: string | null;
}) {
  const t = useT();
  const [f, setF] = useState({
    id: existing?.id as string | undefined,
    full_name: existing?.full_name ?? '',
    phone: existing?.phone ?? '',
    target_class: existing?.target_class ?? '',
    source: existing?.source ?? '',
    next_contact_on: existing?.next_contact_on ?? '',
    note: existing?.note ?? '',
    branch_id: existing?.branch_id ?? defaultBranch,
  });
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  // Mo'ljallangan sinf uchun taklif ro'yxati.
  const classOptions = useClassOptions(f.branch_id).data ?? [];

  return (
    <Modal
      open title={existing ? t('lead.edit') : t('lead.add')} onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" form="lead-form" type="submit"
                  disabled={busy || !f.full_name || !f.phone}>
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <form
        id="lead-form"
        onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }}
        className="space-y-3"
      >
        <Field label={t('common.fullName')} required
               hint="Ota-onaning yoki bolaning ismi">
          <Input value={f.full_name} onChange={(e) => set('full_name', e.target.value)}
                 autoFocus required />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('common.phone')} required>
            <Input value={f.phone} onChange={(e) => set('phone', e.target.value)}
                   inputMode="tel" placeholder="998901234567" required />
          </Field>
          {/* Mavjud sinflar taklif qilinadi, lekin yozish ham
              mumkin: murojaat kelayotgan o'quv yiliga sinf hali
              ochilmagan bo'lishi mumkin. */}
          <Field label={t('lead.targetClass')} hint={t('lead.targetClassHint')}>
            <Input value={f.target_class}
                   onChange={(e) => set('target_class', e.target.value)}
                   list="lead-classes"
                   placeholder="1-A" />
            <datalist id="lead-classes">
              {classOptions.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <CatalogSelect
            kind="lead_source"
            label={t('lead.source')}
            hint={t('lead.sourceHint')}
            value={f.source}
            onChange={(v) => set('source', v)}
          />
          <Field label={t('lead.nextContact')}>
            <Input type="date" value={f.next_contact_on}
                   onChange={(e) => set('next_contact_on', e.target.value)} />
          </Field>
        </div>

        <Field label={t('common.note')}>
          <Input value={f.note} onChange={(e) => set('note', e.target.value)} />
        </Field>

        {branches.length > 1 && (
          <Field label={t('common.branch')} required>
            <Select value={f.branch_id}
                    onChange={(e) => set('branch_id', e.target.value)}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </Select>
          </Field>
        )}

        {error && <Notice tone="danger">{error}</Notice>}
      </form>
    </Modal>
  );
}

function ConvertModal({
  lead, onClose, onSubmit, busy, error,
}: {
  lead: Record<string, unknown> | null;
  onClose: () => void;
  onSubmit: (classId: string | null) => void;
  busy: boolean;
  error: string | null;
}) {
  const t = useT();
  const [classId, setClassId] = useState<string | null>(null);

  return (
    <Modal
      open={!!lead}
      title={t('lead.convert')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="accent" disabled={busy}
                  onClick={() => onSubmit(classId)}>
            {busy ? t('common.saving') : t('common.confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="rounded-md bg-[var(--bg-inset)] px-3 py-2 text-[13px]">
          <div className="font-medium">{String(lead?.full_name ?? '')}</div>
          <div className="num text-[var(--text-muted)]">
            {String(lead?.phone ?? '')}
          </div>
        </div>

        {!!lead?.target_class && (
          <Notice tone="neutral">
            {t('lead.wantedClass', { name: String(lead.target_class) })}
          </Notice>
        )}

        <ClassPicker
          value={classId}
          branchId={(lead?.branch_id as string) ?? null}
          onChange={(c) => setClassId(c.class_id)}
        />

        <Notice tone="neutral">{t('lead.convertHint')}</Notice>
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </Modal>
  );
}
