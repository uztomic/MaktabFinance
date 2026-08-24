// =====================================================================
//  O'quvchilar ro'yxati (TZ 4.3).
//
//  Balans `v_student_balances` ko'rinishidan keladi — u hisoblanma va
//  TASDIQLANGAN to'lovlar farqi sifatida real vaqtda hisoblanadi
//  (TZ 4.8.1). Tasdiqlanmagan chek balansga ta'sir qilmaydi (TZ 4.7.3).
// =====================================================================

import { type FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { ClassPicker } from '@/ui/ClassPicker';
import { useT } from '@/i18n';
import { isoDate } from '@/lib/format';
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Input, Loading,
  Modal, Money, Notice, PageHeader, Select, Table, Td, Th, Tr,
} from '@/ui';

type Status = 'active' | 'academic_leave' | 'expelled';

const STATUS_TONE: Record<Status, 'ok' | 'warn' | 'neutral'> = {
  active: 'ok',
  academic_leave: 'warn',
  expelled: 'neutral',
};

export default function Students() {
  const t = useT();
  const qc = useQueryClient();
  const { branchId, branches, mayWrite, can, profile } = useAuth();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<Status | ''>('active');
  const [adding, setAdding] = useState(false);

  const canEdit = mayWrite('students.manage');

  const list = useQuery({
    queryKey: ['students', branchId, status],
    queryFn: async () => {
      let q = supabase
        .from('v_student_balances')
        .select('student_id, branch_id, full_name, class_name, payment_code, status, charged, paid, balance')
        .order('class_name', { ascending: true, nullsFirst: false })
        .order('full_name');
      if (branchId) q = q.eq('branch_id', branchId);
      if (status) q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  // Qidiruv mijoz tomonda — 1000 tagacha o'quvchi (TZ 5.7) uchun bu
  // serverga borishdan tezroq va buxgalter yozayotganda darhol javob beradi.
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return list.data ?? [];
    return (list.data ?? []).filter((s) =>
      s.full_name?.toLowerCase().includes(needle) ||
      s.class_name?.toLowerCase().includes(needle) ||
      s.payment_code?.toLowerCase().includes(needle)
    );
  }, [list.data, search]);

  const totals = useMemo(() =>
    rows.reduce((acc, r) => {
      const b = Number(r.balance ?? 0);
      return {
        debt: acc.debt + (b > 0 ? b : 0),
        advance: acc.advance + (b < 0 ? -b : 0),
      };
    }, { debt: 0, advance: 0 }), [rows]);

  const create = useMutation({
    mutationFn: async (form: {
      full_name: string; class_id: string | null; grade_level: string;
      branch_id: string; birth_date: string;
    }) => {
      // `class_name` triggerdan keladi — bu yerda yozilmaydi.
      const { data, error } = await supabase.from('students').insert({
        school_id: profile!.school_id,
        branch_id: form.branch_id,
        full_name: form.full_name.trim(),
        class_id: form.class_id,
        grade_level: form.grade_level ? Number(form.grade_level) : null,
        birth_date: form.birth_date || null,
        enrolled_on: isoDate(),
        // payment_code ni baza triggeri o'zi beradi (TZ 4.3.1).
      }).select('id, payment_code').single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['students'] });
      qc.invalidateQueries({ queryKey: ['classes-report'] });
      setAdding(false);
    },
  });

  if (list.isLoading) return <Loading />;
  if (list.error) {
    return <ErrorState message={(list.error as Error).message}
                       onRetry={() => list.refetch()} />;
  }

  if (!can('students.manage')) {
    return <Notice tone="danger">{t('common.noAccess')}</Notice>;
  }

  return (
    <>
      <PageHeader
        title={t('students.title')}
        subtitle={t('common.showing', { count: rows.length })}
        actions={canEdit && (
          <Button variant="primary" onClick={() => setAdding(true)}>
            {t('students.add')}
          </Button>
        )}
      />

      <div className="mb-3 flex flex-wrap gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('students.searchHint')}
          className="max-w-xs"
          type="search"
        />
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value as Status | '')}
          className="w-auto"
        >
          <option value="">{t('common.all')}</option>
          <option value="active">{t('students.status.active')}</option>
          <option value="academic_leave">{t('students.status.academic_leave')}</option>
          <option value="expelled">{t('students.status.expelled')}</option>
        </Select>
      </div>

      <Card padded={false}>
        {rows.length === 0
          ? (
            <EmptyState
              action={canEdit && (
                <Button onClick={() => setAdding(true)}>{t('students.add')}</Button>
              )}
            />
          )
          : (
            <Table>
              <thead>
                <tr>
                  <Th>{t('common.fullName')}</Th>
                  <Th>{t('students.class')}</Th>
                  <Th>{t('students.paymentCode')}</Th>
                  <Th align="right">{t('dashboard.charged')}</Th>
                  <Th align="right">{t('dashboard.collected')}</Th>
                  <Th align="right">{t('students.balance')}</Th>
                  <Th>{t('common.status')}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <Tr key={s.student_id}>
                    <Td>
                      <Link to={`/oquvchilar/${s.student_id}`}
                            className="font-medium hover:underline">
                        {s.full_name}
                      </Link>
                    </Td>
                    <Td className="text-[var(--text-muted)]">{s.class_name ?? '—'}</Td>
                    <Td mono className="text-[var(--text-muted)]">{s.payment_code}</Td>
                    <Td align="right" mono><Money value={s.charged} /></Td>
                    <Td align="right" mono><Money value={s.paid} /></Td>
                    <Td align="right" mono><Money value={s.balance} colored bold /></Td>
                    <Td>
                      <Badge tone={STATUS_TONE[(s.status ?? 'active') as Status]}>
                        {t(`students.status.${s.status}`)}
                      </Badge>
                    </Td>
                  </Tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-[var(--bg-subtle)] font-semibold">
                  <Td className="text-[13px]">{t('common.total')}</Td>
                  <Td /><Td /><Td /><Td />
                  <Td align="right" mono>
                    <div className="text-[var(--danger)]">
                      <Money value={totals.debt} />
                    </div>
                    {totals.advance > 0 && (
                      <div className="text-[11px] font-normal text-[var(--ok)]">
                        {t('students.advance')}: <Money value={totals.advance} />
                      </div>
                    )}
                  </Td>
                  <Td />
                </tr>
              </tfoot>
            </Table>
          )}
      </Card>

      <AddStudentModal
        open={adding}
        onClose={() => setAdding(false)}
        branches={branches}
        defaultBranch={branchId ?? branches[0]?.id ?? ''}
        onSubmit={(form) => create.mutate(form)}
        busy={create.isPending}
        error={create.error ? (create.error as Error).message : null}
      />
    </>
  );
}

// ---------------------------------------------------------------------

function AddStudentModal({
  open, onClose, branches, defaultBranch, onSubmit, busy, error,
}: {
  open: boolean;
  onClose: () => void;
  branches: Array<{ id: string; name: string }>;
  defaultBranch: string;
  onSubmit: (f: {
    full_name: string; class_id: string | null; grade_level: string;
    branch_id: string; birth_date: string;
  }) => void;
  busy: boolean;
  error: string | null;
}) {
  const t = useT();
  const [fullName, setFullName] = useState('');
  const [classId, setClassId] = useState<string | null>(null);
  const [grade, setGrade] = useState('');
  const [branch, setBranch] = useState(defaultBranch);
  const [birth, setBirth] = useState('');

  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit({
      full_name: fullName,
      class_id: classId,
      grade_level: grade,
      branch_id: branch || defaultBranch,
      birth_date: birth,
    });
  }

  return (
    <Modal
      open={open}
      title={t('students.add')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" form="add-student" type="submit" disabled={busy || !fullName}>
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <form id="add-student" onSubmit={submit} className="space-y-3">
        <Field label={t('common.fullName')} required>
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)}
                 autoFocus required />
        </Field>

        <ClassPicker
          value={classId}
          branchId={branch || defaultBranch}
          onChange={(c) => {
            setClassId(c.class_id);
            if (c.grade_level !== null) setGrade(String(c.grade_level));
          }}
        />

        <Field label={t('students.birthDate')}>
          <Input type="date" value={birth} onChange={(e) => setBirth(e.target.value)} />
        </Field>

        {branches.length > 1 && (
          <Field label={t('common.branch')} required>
            <Select value={branch} onChange={(e) => setBranch(e.target.value)}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </Select>
          </Field>
        )}

        <Notice tone="neutral">
          {t('students.paymentCode')} — tizim avtomatik beradi.
        </Notice>

        {error && <Notice tone="danger">{error}</Notice>}
      </form>
    </Modal>
  );
}
