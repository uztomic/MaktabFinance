// =====================================================================
//  Sinf tanlagich.
//
//  Ilgari sinf o'quvchi kartochkasida ERKIN MATN edi. Natijasi:
//  "5-A", "5A", "5 A", "5-a" — bir sinf to'rt xil yozilib, sinf
//  kesimidagi hisobot ma'nosini yo'qotardi.
//
//  Endi FAQAT mavjud sinfdan tanlanadi. Lekin ro'yxat yopiq emas:
//  kerakli sinf yo'q bo'lsa shu yerning o'zida yaratiladi —
//  "Sinflar" bo'limiga borib qaytish shart emas.
//
//  Tanlangan sinfning `grade_level` i ham qaytariladi: o'quvchidagi
//  bosqich raqami sinfnikidan farq qilib qolmasin.
// =====================================================================

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useT } from '@/i18n';
import { Button, Field, Input, Select } from './index';
import { useToast } from './Feedback';

export interface ClassChoice {
  class_id: string | null;
  grade_level: number | null;
}

export function useClassOptions(branchId: string | null | undefined) {
  return useQuery({
    queryKey: ['class-options', branchId ?? null],
    queryFn: async () => {
      let q = supabase
        .from('classes')
        .select('id, name, grade_level, academic_year, capacity, branch_id')
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('grade_level', { nullsFirst: false })
        .order('name');
      if (branchId) q = q.eq('branch_id', branchId);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Joriy o'quv yili: avgustdan boshlab yangi yil hisoblanadi. */
function currentAcademicYear(): string {
  const now = new Date();
  const y = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return `${y}/${y + 1}`;
}

export function ClassPicker({
  value, branchId, onChange, label, allowCreate = true,
}: {
  value: string | null;
  /** Filial berilsa faqat o'sha filial sinflari ko'rsatiladi. */
  branchId?: string | null;
  onChange: (choice: ClassChoice) => void;
  label?: string;
  /** Yangi sinf yaratish tugmasi ko'rinsinmi. */
  allowCreate?: boolean;
}) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const { profile, branches, mayWrite } = useAuth();

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [grade, setGrade] = useState('');
  const [year, setYear] = useState(currentAcademicYear());

  const options = useClassOptions(branchId);
  const list = options.data ?? [];
  const canCreate = allowCreate && mayWrite('students.manage');

  const create = useMutation({
    mutationFn: async () => {
      const clean = name.trim();
      if (!clean) throw new Error(t('cls.nameRequired'));

      const targetBranch = branchId ?? branches[0]?.id;
      if (!targetBranch) throw new Error(t('cls.noBranch'));

      // Shu nomli sinf bormi? Bo'lsa yangisini yaratmaymiz —
      // dublikat sinf hisobotni ikkiga bo'lib yuboradi.
      const existing = list.find(
        (c) => c.name.toLowerCase() === clean.toLowerCase()
          && c.academic_year === year);
      if (existing) {
        return { id: existing.id, grade_level: existing.grade_level };
      }

      const { data, error } = await supabase.from('classes').insert({
        school_id: profile!.school_id,
        branch_id: targetBranch,
        name: clean,
        grade_level: grade ? Number(grade) : null,
        academic_year: year,
      }).select('id, grade_level').single();
      if (error) throw error;
      return data;
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ['class-options'] });
      qc.invalidateQueries({ queryKey: ['classes-report'] });
      qc.invalidateQueries({ queryKey: ['classes-meta'] });
      onChange({ class_id: row.id, grade_level: row.grade_level ?? null });
      toast.ok(t('cls.created', { name: name.trim() }));
      setCreating(false);
      setName('');
      setGrade('');
    },
    onError: (e) => toast.error((e as Error).message),
  });

  // --- Yangi sinf yaratish ko'rinishi -------------------------------
  if (creating) {
    return (
      <Field label={label ?? t('students.class')} hint={t('cls.createHint')}>
        <div className="space-y-2 rounded-md border border-dashed p-2.5">
          <div className="grid gap-2 sm:grid-cols-[1fr_5rem]">
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                // "5-A" dan bosqichni o'zi topadi — qo'lda yozish shart emas.
                const m = e.target.value.match(/(\d{1,2})/);
                if (m) setGrade(m[1]);
              }}
              placeholder="5-A"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); create.mutate(); }
                if (e.key === 'Escape') { e.preventDefault(); setCreating(false); }
              }}
            />
            <Input
              type="number" min={0} max={12} value={grade}
              onChange={(e) => setGrade(e.target.value)}
              placeholder={t('cls.grade')}
              title={t('cls.grade')}
            />
          </div>
          <Input
            value={year}
            onChange={(e) => setYear(e.target.value)}
            placeholder="2026/2027"
            title={t('cls.year')}
          />
          <div className="flex gap-1.5">
            <Button type="button" variant="primary" size="sm"
                    disabled={create.isPending || !name.trim()}
                    onClick={() => create.mutate()}>
              {create.isPending ? t('common.saving') : t('cls.create')}
            </Button>
            <Button type="button" size="sm" onClick={() => setCreating(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      </Field>
    );
  }

  // --- Sinf umuman yo'q ---------------------------------------------
  if (!options.isLoading && list.length === 0) {
    return (
      <Field label={label ?? t('students.class')}>
        <div className="rounded-md border border-dashed px-2.5 py-2
          text-[13px] text-[var(--text-muted)]">
          {t('cls.none')}{' '}
          {canCreate && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="font-medium text-brand-700 hover:underline"
            >
              {t('cls.createFirst')} →
            </button>
          )}
        </div>
      </Field>
    );
  }

  return (
    <Field label={label ?? t('students.class')} hint={t('students.classHint')}>
      <div className="flex gap-1.5">
        <Select
          value={value ?? ''}
          disabled={options.isLoading}
          onChange={(e) => {
            const id = e.target.value || null;
            const picked = list.find((c) => c.id === id);
            onChange({
              class_id: id,
              grade_level: picked?.grade_level ?? null,
            });
          }}
        >
          <option value="">{t('cls.noClass')}</option>
          {list.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.academic_year ? ` · ${c.academic_year}` : ''}
            </option>
          ))}
        </Select>
        {canCreate && (
          <Button
            type="button"
            size="md"
            title={t('cls.add')}
            onClick={() => setCreating(true)}
            className="shrink-0"
          >
            +
          </Button>
        )}
      </div>
    </Field>
  );
}
