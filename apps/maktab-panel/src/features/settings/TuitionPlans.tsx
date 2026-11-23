// =====================================================================
//  Sozlamalar → Tariflar.
//
//  Maktabning o'qish narxlari bir joyda: "Boshlang'ich sinflar (1–4)",
//  "Yuqori sinflar (5–11)", "Bog'cha"… o'quv yili bo'yicha. O'quvchi
//  qo'shilganda sinfiga mos tarif o'zi tanlanadi — narx qo'lda
//  yozilmaydi. Tarif o'zgartirilsa ESKI shartnomalar o'zgarmaydi
//  (narx shartnomaga nusxalangan), yangilari yangi narx bilan.
// =====================================================================

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n, useT } from '@/i18n';
import { money } from '@/lib/format';
import { Badge, Button, Card, EmptyState, Field, Input, Loading, Modal, MoneyInput, Notice } from '@/ui';

interface Plan {
  id: string; name: string; academic_year: string | null;
  grade_from: number | null; grade_to: number | null;
  monthly_amount: number; is_active: boolean; sort_order: number;
}

export function TuitionPlans({ editable }: { editable: boolean }) {
  const t = useT();
  const { lang } = useI18n();
  const [edit, setEdit] = useState<Plan | 'new' | null>(null);

  const q = useQuery({
    queryKey: ['tuition-plans-all'],
    queryFn: async () => {
      const { data, error } = await supabase.from('tuition_plans')
        .select('id, name, academic_year, grade_from, grade_to, monthly_amount, is_active, sort_order')
        .order('is_active', { ascending: false }).order('sort_order').order('name');
      if (error) throw error;
      return (data ?? []) as Plan[];
    },
  });

  const grades = (p: Plan) => p.grade_from === null && p.grade_to === null ? '—'
    : p.grade_from === p.grade_to ? (p.grade_from === 0 ? t('tp.kinder') : `${p.grade_from}-${t('tp.gradeShort')}`)
    : `${p.grade_from ?? 0}–${p.grade_to ?? 11} ${t('tp.gradeShort')}`;

  return (
    <>
      <Card
        padded={false}
        title={t('tp.title')}
        action={editable && <Button size="sm" variant="primary" onClick={() => setEdit('new')}>+ {t('tp.add')}</Button>}
      >
        {q.isLoading ? <Loading /> : (q.data?.length ?? 0) === 0 ? <EmptyState hint="" /> : (
          <div>
            {q.data!.map((p) => (
              <button key={p.id} type="button" disabled={!editable} onClick={() => setEdit(p)}
                className={`flex w-full items-center gap-4 border-b border-[var(--border-soft)] px-5 py-3 text-left
                  last:border-b-0 hover:bg-[var(--bg-subtle)] disabled:cursor-default ${p.is_active ? '' : 'opacity-50'}`}>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-medium">{p.name}</div>
                  <div className="text-[12px] text-[var(--text-faint)]">
                    {grades(p)}{p.academic_year ? ` · ${p.academic_year}` : ''}
                  </div>
                </div>
                {!p.is_active && <Badge>{t('common.inactive')}</Badge>}
                <div className="num text-[15px] font-semibold">{money(p.monthly_amount, lang)}</div>
              </button>
            ))}
          </div>
        )}
      </Card>
      {edit && <PlanModal plan={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function PlanModal({ plan, onClose }: { plan: Plan | null; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const { profile } = useAuth();
  const [f, setF] = useState({
    name: plan?.name ?? '',
    academic_year: plan?.academic_year ?? '',
    grade_from: plan?.grade_from === null || plan?.grade_from === undefined ? '' : String(plan.grade_from),
    grade_to: plan?.grade_to === null || plan?.grade_to === undefined ? '' : String(plan.grade_to),
    amount: plan ? String(plan.monthly_amount) : '',
    is_active: plan?.is_active ?? true,
  });
  const set = (k: keyof typeof f, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name: f.name.trim(),
        academic_year: f.academic_year.trim() || null,
        grade_from: f.grade_from === '' ? null : Number(f.grade_from),
        grade_to: f.grade_to === '' ? (f.grade_from === '' ? null : Number(f.grade_from)) : Number(f.grade_to),
        monthly_amount: Number(f.amount) || 0,
        is_active: f.is_active,
        sort_order: f.grade_from === '' ? 0 : Number(f.grade_from),
      };
      const { error } = plan
        ? await supabase.from('tuition_plans').update(payload).eq('id', plan.id)
        : await supabase.from('tuition_plans').insert({ ...payload, school_id: profile!.school_id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tuition-plans-all'] });
      qc.invalidateQueries({ queryKey: ['tuition-plans'] });
      onClose();
    },
  });

  const bad = !f.name.trim() || !(Number(f.amount) > 0)
    || (f.grade_from !== '' && f.grade_to !== '' && Number(f.grade_from) > Number(f.grade_to));

  return (
    <Modal open title={plan ? t('tp.edit') : t('tp.add')} onClose={onClose}
      footer={<>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" disabled={bad || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? t('common.saving') : t('common.save')}
        </Button>
      </>}>
      <div className="space-y-3">
        <Field label={t('tp.name')} required>
          <Input value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus
                 placeholder={t('tp.namePlaceholder')} />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label={t('tp.gradeFrom')}>
            <Input type="number" min={0} max={12} value={f.grade_from}
                   onChange={(e) => set('grade_from', e.target.value)} className="num" />
          </Field>
          <Field label={t('tp.gradeTo')}>
            <Input type="number" min={0} max={12} value={f.grade_to}
                   onChange={(e) => set('grade_to', e.target.value)} className="num" />
          </Field>
          <Field label={t('tp.year')}>
            <Input value={f.academic_year} onChange={(e) => set('academic_year', e.target.value)}
                   placeholder="2026/2027" />
          </Field>
        </div>
        <Field label={t('tp.monthly')} required>
          <MoneyInput value={f.amount} onChange={(e) => set('amount', e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" className="h-4 w-4" checked={f.is_active}
                 onChange={(e) => set('is_active', e.target.checked)} />
          {t('tp.active')}
        </label>
        {plan && <Notice tone="neutral">{t('tp.oldContracts')}</Notice>}
        {save.error && <Notice tone="danger">{(save.error as Error).message}</Notice>}
      </div>
    </Modal>
  );
}
