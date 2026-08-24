// =====================================================================
//  O'quvchi kartochkasining oynalari: shartnoma, xizmat, ota-ona.
//
//  Bularsiz buxgalter o'quvchini to'liq sozlay olmaydi — hisoblanma
//  shartnomasiz shakllanmaydi (TZ 4.6), kunlik xizmat esa xizmatga
//  yozilmasdan hisoblanmaydi (TZ 4.4.2).
//
//  TZ 12.2.1 — "To'lov 9 oyga taqsimlanadimi yoki 12 oyga?" savoliga
//  javob shu yerda beriladi: ikkala variant ham bor, maktab o'zi
//  tanlaydi va har bir shartnoma uchun alohida belgilanadi.
// =====================================================================

import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { ClassPicker } from '@/ui/ClassPicker';
import { useT } from '@/i18n';
import { isoDate } from '@/lib/format';
import {
  Button, Field, Input, Modal, MoneyInput, Notice, Select,
} from '@/ui';

// =====================================================================
//  SHARTNOMA (TZ 4.3)
// =====================================================================

interface ContractRow {
  id: string;
  number: string;
  signed_on: string;
  starts_on: string;
  ends_on: string | null;
  tuition_amount: number;
  discount_type_id: string | null;
  discount_kind: 'percent' | 'amount' | null;
  discount_value: number | null;
  due_day: number;
  billing_months: number;
  note: string | null;
}

export function ContractModal({
  open, onClose, studentId, existing,
}: {
  open: boolean;
  onClose: () => void;
  studentId: string;
  existing: ContractRow | null;
}) {
  const t = useT();
  const qc = useQueryClient();
  const { profile } = useAuth();

  const discountTypes = useQuery({
    queryKey: ['discount-types'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('discount_types')
        .select('id, code, name, kind, value')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });

  // "manual" — chegirma qo'lda kiritiladi; bo'sh — chegirmasiz.
  const initialDiscount = existing?.discount_kind
    ? 'manual'
    : existing?.discount_type_id ?? '';

  const [f, setF] = useState({
    number: existing?.number ?? '',
    signed_on: existing?.signed_on ?? isoDate(),
    starts_on: existing?.starts_on ?? isoDate(),
    ends_on: existing?.ends_on ?? '',
    tuition: String(existing?.tuition_amount ?? ''),
    discount: initialDiscount,
    discount_kind: existing?.discount_kind ?? 'percent',
    discount_value: String(existing?.discount_value ?? ''),
    due_day: String(existing?.due_day ?? 10),
    months_mode: existing
      ? (existing.billing_months === 12
        ? '12'
        : existing.billing_months === 9 ? '9' : 'other')
      : '12',
    months_other: String(existing?.billing_months ?? 12),
    note: existing?.note ?? '',
  });

  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  const billingMonths = f.months_mode === 'other'
    ? Math.min(12, Math.max(1, Number(f.months_other) || 12))
    : Number(f.months_mode);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        school_id: profile!.school_id,
        student_id: studentId,
        number: f.number.trim(),
        signed_on: f.signed_on,
        starts_on: f.starts_on,
        ends_on: f.ends_on || null,
        tuition_amount: Number(f.tuition) || 0,
        discount_type_id: f.discount && f.discount !== 'manual' ? f.discount : null,
        discount_kind: f.discount === 'manual'
          ? (f.discount_kind as 'percent' | 'amount')
          : null,
        discount_value: f.discount === 'manual'
          ? Number(f.discount_value) || 0
          : null,
        due_day: Number(f.due_day) || 10,
        billing_months: billingMonths,
        note: f.note.trim() || null,
        is_active: true,
      };

      if (existing) {
        const { error } = await supabase
          .from('contracts')
          .update(payload)
          .eq('id', existing.id);
        if (error) throw error;
      } else {
        // Eski faol shartnoma bo'lsa uni arxivga o'tkazamiz —
        // bir o'quvchida bir vaqtda bitta faol shartnoma (TZ 4.3.5).
        const { error: offErr } = await supabase
          .from('contracts')
          .update({ is_active: false })
          .eq('student_id', studentId)
          .eq('is_active', true);
        if (offErr) throw offErr;

        const { error } = await supabase.from('contracts').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['student-contract', studentId] });
      qc.invalidateQueries({ queryKey: ['students'] });
      onClose();
    },
  });

  return (
    <Modal
      open={open}
      title={existing ? t('contracts.edit') : t('contracts.add')}
      onClose={onClose}
      wide
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="primary" form="contract-form" type="submit"
            disabled={save.isPending || !f.number || !f.tuition}
          >
            {save.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <form
        id="contract-form"
        onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }}
        className="space-y-4"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('contracts.number')} required>
            <Input value={f.number} onChange={(e) => set('number', e.target.value)}
                   placeholder="SH-001" autoFocus required />
          </Field>
          <Field label={t('contracts.signedOn')} required>
            <Input type="date" value={f.signed_on}
                   onChange={(e) => set('signed_on', e.target.value)} required />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('contracts.startsOn')} required>
            <Input type="date" value={f.starts_on}
                   onChange={(e) => set('starts_on', e.target.value)} required />
          </Field>
          <Field label={t('contracts.endsOn')} hint="Bo'sh = muddatsiz">
            <Input type="date" value={f.ends_on}
                   onChange={(e) => set('ends_on', e.target.value)} />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('contracts.tuition')} required>
            <MoneyInput value={f.tuition}
                        onChange={(e) => set('tuition', e.target.value)} required />
          </Field>
          <Field label={t('contracts.dueDay')} required
                 hint="Oyning nechanchi sanasi">
            <Input type="number" min={1} max={28} value={f.due_day}
                   onChange={(e) => set('due_day', e.target.value)} required />
          </Field>
        </div>

        {/* --- TZ 12.2.1: 9 oy yoki 12 oy ------------------------- */}
        <div>
          <div className="mb-1.5 text-[13px] font-medium text-[var(--text-muted)]">
            {t('contracts.billingMonths')}
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {(['12', '9', 'other'] as const).map((mode) => {
              const active = f.months_mode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => set('months_mode', mode)}
                  className={`rounded-lg border p-2.5 text-left transition-colors
                    ${active
                      ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-600'
                      : 'hover:bg-[var(--bg-subtle)]'}`}
                >
                  <div className={`text-[13px] font-medium
                    ${active ? 'text-brand-900' : ''}`}>
                    {t(`contracts.months${mode === 'other' ? 'Other' : mode}`)}
                  </div>
                  <div className={`mt-0.5 text-[11px]
                    ${active ? 'text-brand-800' : 'text-[var(--text-muted)]'}`}>
                    {t(`contracts.months${mode === 'other' ? 'Other' : mode}.hint`)}
                  </div>
                </button>
              );
            })}
          </div>

          {f.months_mode === 'other' && (
            <div className="mt-2 max-w-[10rem]">
              <Input
                type="number" min={1} max={12}
                value={f.months_other}
                onChange={(e) => set('months_other', e.target.value)}
                className="num text-right"
              />
            </div>
          )}
        </div>

        {/* --- Chegirma (TZ 12.2.3, 12.2.4) ---------------------- */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('contracts.discountType')}>
            <Select value={f.discount} onChange={(e) => set('discount', e.target.value)}>
              <option value="">{t('contracts.discountNone')}</option>
              {(discountTypes.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} — {d.kind === 'percent' ? `${d.value}%` : d.value}
                </option>
              ))}
              <option value="manual">{t('contracts.discountManual')}</option>
            </Select>
          </Field>

          {f.discount === 'manual' && (
            <div className="grid grid-cols-2 gap-2">
              <Field label={t('pf.row.type')}>
                <Select value={f.discount_kind}
                        onChange={(e) => set('discount_kind', e.target.value)}>
                  <option value="percent">%</option>
                  <option value="amount">so'm</option>
                </Select>
              </Field>
              <Field label={t('pf.row.value')}>
                <Input type="number" min={0} value={f.discount_value}
                       onChange={(e) => set('discount_value', e.target.value)}
                       className="num text-right" />
              </Field>
            </div>
          )}
        </div>

        <Field label={t('common.note')}>
          <Input value={f.note} onChange={(e) => set('note', e.target.value)} />
        </Field>

        {!existing && <Notice tone="neutral">{t('contracts.replaceWarning')}</Notice>}
        {save.error && <Notice tone="danger">{(save.error as Error).message}</Notice>}
      </form>
    </Modal>
  );
}

// =====================================================================
//  XIZMAT BIRIKTIRISH (TZ 4.4.2, 4.4.3)
// =====================================================================

export function ServiceModal({
  open, onClose, studentId, branchId, assignedIds,
}: {
  open: boolean;
  onClose: () => void;
  studentId: string;
  branchId: string;
  assignedIds: string[];
}) {
  const t = useT();
  const qc = useQueryClient();
  const { profile } = useAuth();

  const [serviceId, setServiceId] = useState('');
  const [startsOn, setStartsOn] = useState(isoDate());

  const services = useQuery({
    queryKey: ['services-for-assign', branchId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('services')
        .select('id, name, billing_type, service_prices(price, valid_from, valid_to)')
        .eq('branch_id', branchId)
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('sort_order');
      if (error) throw error;
      return data ?? [];
    },
  });

  const chosen = (services.data ?? []).find((s) => s.id === serviceId);
  // deno-lint-ignore no-explicit-any
  const hasPrice = ((chosen as any)?.service_prices ?? []).length > 0;
  const already = assignedIds.includes(serviceId);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('student_services').insert({
        school_id: profile!.school_id,
        student_id: studentId,
        service_id: serviceId,
        starts_on: startsOn,
        created_by: profile!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['student-services', studentId] });
      setServiceId('');
      onClose();
    },
  });

  return (
    <Modal
      open={open}
      title={t('services.assign')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="primary" form="assign-service" type="submit"
            disabled={save.isPending || !serviceId || already}
          >
            {save.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <form
        id="assign-service"
        onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }}
        className="space-y-3"
      >
        <Field label={t('services.title')} required>
          <Select value={serviceId} onChange={(e) => setServiceId(e.target.value)}
                  autoFocus required>
            <option value="">—</option>
            {(services.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {t(`services.type.${s.billing_type}`)}
              </option>
            ))}
          </Select>
        </Field>

        {chosen && (
          <Notice tone="neutral">
            {t(`services.type.${chosen.billing_type}.hint`)}
          </Notice>
        )}

        <Field label={t('services.validFrom')} hint={t('services.assignHint')} required>
          <Input type="date" value={startsOn}
                 onChange={(e) => setStartsOn(e.target.value)} required />
        </Field>

        {already && <Notice tone="warn">{t('services.alreadyAssigned')}</Notice>}
        {serviceId && !hasPrice && (
          <Notice tone="danger">{t('services.noPrice')}</Notice>
        )}
        {save.error && <Notice tone="danger">{(save.error as Error).message}</Notice>}
      </form>
    </Modal>
  );
}

// =====================================================================
//  OTA-ONA (TZ 4.3.2, 4.9.1)
// =====================================================================

export interface ParentLink {
  parent_id: string;
  full_name: string;
  phone: string;
  lang: string;
  relation: string | null;
  is_primary: boolean;
  telegram_id?: number | null;
}

export function ParentModal({
  open, onClose, studentId, existing = null,
}: {
  open: boolean;
  onClose: () => void;
  studentId: string;
  /** Berilsa — tahrirlash rejimi. */
  existing?: ParentLink | null;
}) {
  const t = useT();
  const qc = useQueryClient();
  const { profile } = useAuth();

  const [f, setF] = useState({
    full_name: existing?.full_name ?? '',
    phone: existing?.phone ?? '',
    relation: existing?.relation ?? 'father',
    lang: existing?.lang ?? 'uz',
    is_primary: existing?.is_primary ?? true,
  });

  const set = (k: string, v: string | boolean) =>
    setF((p) => ({ ...p, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      const phone = f.phone.replace(/\D/g, '');

      // --- TAHRIRLASH -----------------------------------------
      // Ota-ona yozuvi va bog'lanish alohida jadvallarda, shuning
      // uchun ikkisi ham yangilanadi. Telegram ulanishiga
      // TEGILMAYDI — uni ota-onaning o'zi bot orqali ulagan.
      if (existing) {
        const { error: pe } = await supabase
          .from('parents')
          .update({
            full_name: f.full_name.trim(),
            phone,
            lang: f.lang,
          })
          .eq('id', existing.parent_id);
        if (pe) throw pe;

        const { error: le } = await supabase
          .from('student_parents')
          .update({ relation: f.relation, is_primary: f.is_primary })
          .eq('student_id', studentId)
          .eq('parent_id', existing.parent_id);
        if (le) throw le;
        return;
      }

      // Shu raqamli ota-ona bormi? Bo'lsa yangisini yaratmaymiz —
      // bir ota-ona bir nechta farzandga biriktiriladi (TZ 4.9.2).
      const { data: found } = await supabase
        .from('parents')
        .select('id')
        .eq('phone', phone)
        .is('deleted_at', null)
        .maybeSingle();

      let parentId = found?.id;

      if (!parentId) {
        const { data, error } = await supabase.from('parents').insert({
          school_id: profile!.school_id,
          full_name: f.full_name.trim(),
          phone,
          lang: f.lang,
        }).select('id').single();
        if (error) throw error;
        parentId = data.id;
      }

      const { error: linkErr } = await supabase.from('student_parents').insert({
        student_id: studentId,
        parent_id: parentId,
        relation: f.relation,
        is_primary: f.is_primary,
      });
      if (linkErr) throw linkErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['student-parents', studentId] });
      onClose();
    },
  });

  return (
    <Modal
      open={open}
      title={existing ? t('parents.edit') : t('parents.add')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="primary" form="add-parent" type="submit"
            disabled={save.isPending || !f.full_name || f.phone.replace(/\D/g, '').length < 9}
          >
            {save.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <form
        id="add-parent"
        onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }}
        className="space-y-3"
      >
        <Field label={t('common.fullName')} required>
          <Input value={f.full_name} onChange={(e) => set('full_name', e.target.value)}
                 autoFocus required />
        </Field>

        <Field label={t('common.phone')} hint={t('parents.phoneHint')} required>
          <Input value={f.phone} onChange={(e) => set('phone', e.target.value)}
                 inputMode="tel" placeholder="998901234567" required />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('parents.relation')}>
            <Select value={f.relation} onChange={(e) => set('relation', e.target.value)}>
              <option value="father">{t('parents.relation.father')}</option>
              <option value="mother">{t('parents.relation.mother')}</option>
              <option value="guardian">{t('parents.relation.guardian')}</option>
            </Select>
          </Field>
          <Field label={t('parents.lang')}>
            <Select value={f.lang} onChange={(e) => set('lang', e.target.value)}>
              <option value="uz">O'zbekcha</option>
              <option value="uz-cyrl">Ўзбекча</option>
              <option value="ru">Русский</option>
            </Select>
          </Field>
        </div>

        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={f.is_primary}
            onChange={(e) => set('is_primary', e.target.checked)}
            className="h-4 w-4"
          />
          {t('parents.isPrimary')}
        </label>

        {existing
          ? (
            <Notice tone="neutral">
              {existing.telegram_id
                ? t('parents.telegramLinked')
                : t('parents.telegramNotLinked')}
            </Notice>
          )
          : <Notice tone="neutral">{t('parents.existing')}</Notice>}
        {save.error && <Notice tone="danger">{(save.error as Error).message}</Notice>}
      </form>
    </Modal>
  );
}

// =====================================================================
//  O'QUVCHINI TAHRIRLASH (TZ 4.1.5, 4.3.4, 4.3.6)
//
//  TZ 4.3.4 — o'quvchi chiqarilganda ma'lumot O'CHIRILMAYDI, faqat
//  holati o'zgaradi va moliyaviy tarix saqlanadi.
//  TZ 4.1.5 — filialdan filialga o'tkazilganda ham tarix saqlanadi.
// =====================================================================

export function StudentEditModal({
  open, onClose, student,
}: {
  open: boolean;
  onClose: () => void;
  // deno-lint-ignore no-explicit-any
  student: any;
}) {
  const t = useT();
  const qc = useQueryClient();
  const { branches } = useAuth();

  const [f, setF] = useState({
    full_name: student?.full_name ?? '',
    class_id: (student?.class_id ?? null) as string | null,
    grade_level: String(student?.grade_level ?? ''),
    birth_date: student?.birth_date ?? '',
    status: student?.status ?? 'active',
    branch_id: student?.branch_id ?? '',
    left_on: student?.left_on ?? '',
    note: student?.note ?? '',
  });
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      // `class_name` YOZILMAYDI: uni `class_id` bo'yicha baza
      // triggeri to'ldiradi, shunda ikki manba uzilib qolmaydi.
      const { error } = await supabase.from('students').update({
        full_name: f.full_name.trim(),
        class_id: f.class_id,
        grade_level: f.grade_level ? Number(f.grade_level) : null,
        birth_date: f.birth_date || null,
        status: f.status as 'active' | 'academic_leave' | 'expelled',
        branch_id: f.branch_id,
        left_on: f.status === 'expelled' ? (f.left_on || isoDate()) : null,
        note: f.note.trim() || null,
      }).eq('id', student.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['student', student.id] });
      qc.invalidateQueries({ queryKey: ['students'] });
      qc.invalidateQueries({ queryKey: ['classes-report'] });
      qc.invalidateQueries({ queryKey: ['class-students'] });
      onClose();
    },
  });

  const branchChanged = f.branch_id !== student?.branch_id;

  return (
    <Modal
      open={open}
      title={t('student.edit.title')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" form="edit-student" type="submit"
                  disabled={save.isPending || !f.full_name}>
            {save.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <form
        id="edit-student"
        onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }}
        className="space-y-3"
      >
        <Field label={t('common.fullName')} required>
          <Input value={f.full_name} onChange={(e) => set('full_name', e.target.value)}
                 autoFocus required />
        </Field>

        <ClassPicker
          value={f.class_id}
          branchId={f.branch_id}
          onChange={(c) => setF((p) => ({
            ...p,
            class_id: c.class_id,
            // Bosqich sinfdan olinadi — o'quvchida boshqacha turib
            // qolmasin.
            grade_level: c.grade_level !== null
              ? String(c.grade_level)
              : p.grade_level,
          }))}
        />

        <Field label={t('students.birthDate')}>
          <Input type="date" value={f.birth_date}
                 onChange={(e) => set('birth_date', e.target.value)} />
        </Field>

        <Field label={t('common.status')} hint={t('student.statusHint')} required>
          <Select value={f.status} onChange={(e) => set('status', e.target.value)}>
            <option value="active">{t('students.status.active')}</option>
            <option value="academic_leave">
              {t('students.status.academic_leave')}
            </option>
            <option value="expelled">{t('students.status.expelled')}</option>
          </Select>
        </Field>

        {f.status === 'expelled' && (
          <Field label={t('students.leftOn')} hint="Bo'sh = bugun">
            <Input type="date" value={f.left_on}
                   onChange={(e) => set('left_on', e.target.value)} />
          </Field>
        )}

        {branches.length > 1 && (
          <Field label={t('student.transfer')}
                 hint={branchChanged ? t('student.transferHint') : undefined}>
            <Select value={f.branch_id}
                    onChange={(e) => set('branch_id', e.target.value)}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </Select>
          </Field>
        )}

        <Field label={t('common.note')}>
          <Input value={f.note} onChange={(e) => set('note', e.target.value)} />
        </Field>

        {f.status !== 'active' && (
          <Notice tone="warn">
            {f.status === 'expelled'
              ? t('student.expelWarning')
              : t('student.leaveWarning')}
          </Notice>
        )}
        {save.error && <Notice tone="danger">{(save.error as Error).message}</Notice>}
      </form>
    </Modal>
  );
}
