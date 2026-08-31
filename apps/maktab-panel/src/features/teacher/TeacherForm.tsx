// =====================================================================
//  O'qituvchi formasi — ro'yxatda ham, kartochkada ham SHU forma.
//
//  NEGA AJRATILDI: forma faqat ro'yxat sahifasida edi. Kartochkaga
//  kirgan odam tahrirlash tugmasini topa olmasdi va orqaga qaytib,
//  ro'yxatdan qidirib, o'sha qatordagi tugmani bosishi kerak edi.
//  Ikki nusxa forma yozish esa vaqt o'tishi bilan ikki xil bo'lib
//  ketardi — masalan sinf biriktirish bir joyda bo'lib, ikkinchisida
//  bo'lmay qolardi.
// =====================================================================

import { type FormEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useT } from '@/i18n';
import { isoDate } from '@/lib/format';
import {
  Button, Field, Input, Modal, MoneyInput, Notice, Select,
} from '@/ui';
import { isCompletePhone, PhoneInput } from '@/ui/PhoneInput';
import { useToast } from '@/ui/Feedback';
import { CatalogSelect } from '@/ui/CatalogSelect';
import { ClassPicker } from '@/ui/ClassPicker';
import { SalaryPreview } from './SalaryPreview';

/**
 *  Sinf rahbarini biriktirish.
 *
 *  Bir sinfda bitta rahbar bo'ladi, shuning uchun o'qituvchi boshqa
 *  sinfga ko'chirilsa eskisidan uzib qo'yiladi — aks holda u ikkita
 *  sinfning rahbari bo'lib qolardi va sinf rahbarligi ustamasi ikki
 *  marta hisoblanardi.
 */
async function setClassTeacher(
  teacherId: string,
  classId: string | null,
  prevClassId: string | null,
) {
  if ((classId || null) === (prevClassId || null)) return;

  if (prevClassId) {
    const { error } = await supabase.from('classes')
      .update({ teacher_id: null }).eq('id', prevClassId);
    if (error) throw error;
  }
  if (classId) {
    const { error } = await supabase.from('classes')
      .update({ teacher_id: teacherId }).eq('id', classId);
    if (error) throw error;
  }
}

/** Yangi hisob ma'lumotlari — bir marta ko'rsatiladi. */
export interface NewLogin {
  full_name: string;
  login: string;
  password: string;
}

/**
 *  O'qituvchiga tizimga kirish hisobini yaratadi.
 *
 *  NEGA SHU YERDA, alohida sahifada emas: o'qituvchi va uning hisobi —
 *  bitta odam. Ilgari ular ikki joyda yaratilardi va bog'lanish
 *  `teachers.user_id` orqali QO'LDA o'rnatilishi kerak edi. Amalda bu
 *  qadam unutilardi: o'qituvchi ro'yxatda turadi, lekin tizimga kira
 *  olmaydi va davomat olmaydi.
 *
 *  Login sifatida TELEFON raqami ishlatiladi — o'qituvchi va navbatchi
 *  aynan shunday kiradi (pochta faqat direktor va buxgalterda).
 */
async function createTeacherLogin(
  teacherId: string,
  fullName: string,
  phone: string,
  branchId: string,
): Promise<NewLogin> {
  const { data, error } = await supabase.functions.invoke('school-user-ops', {
    body: {
      action: 'create',
      full_name: fullName,
      login: phone,
      role: 'teacher',
      all_branches: false,
      branch_ids: [branchId],
    },
  });
  if (error) throw error;
  if (!data?.user_id) throw new Error(data?.error ?? 'Hisob yaratilmadi');

  //  Bog'lanish. Busiz hisob bor, lekin o'qituvchi bilan bog'liq emas
  //  va "mening sinflarim" bo'sh chiqadi.
  const { error: linkErr } = await supabase.from('teachers')
    .update({ user_id: data.user_id }).eq('id', teacherId);
  if (linkErr) throw linkErr;

  return { full_name: fullName, login: data.login, password: data.password };
}

/**
 *  Yangi hisob ma'lumotlari.
 *
 *  Parol serverda yaratiladi va HECH QAYERDA saqlanmaydi — faqat shu
 *  javobda bir marta keladi. Shuning uchun uni ko'rsatmasdan oynani
 *  yopib bo'lmaydi: aks holda hisob yaratilgan, lekin unga kirib
 *  bo'lmaydigan holat qoladi.
 */
export function TeacherCredentials({ data, onClose }: {
  data: NewLogin;
  onClose: () => void;
}) {
  const t = useT();

  return (
    <Modal
      open
      title={t('teachers.loginCreated')}
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={onClose}>{t('common.close')}</Button>
      }
    >
      <div className="space-y-3">
        <Notice tone="warn">{t('teachers.loginCreatedHint')}</Notice>

        <div className="rounded-md bg-[var(--bg-inset)] px-3 py-2">
          <div className="text-[11px] uppercase text-[var(--text-muted)]">
            {t('common.fullName')}
          </div>
          <div className="font-medium">{data.full_name}</div>
        </div>

        <div className="rounded-md bg-[var(--bg-inset)] px-3 py-2">
          <div className="text-[11px] uppercase text-[var(--text-muted)]">
            {t('auth.login')}
          </div>
          <div className="num text-lg font-semibold">{data.login}</div>
        </div>

        <div className="rounded-md bg-[var(--bg-inset)] px-3 py-2">
          <div className="text-[11px] uppercase text-[var(--text-muted)]">
            {t('auth.password')}
          </div>
          <div className="num text-lg font-semibold">{data.password}</div>
        </div>
      </div>
    </Modal>
  );
}

/** Yangi o'qituvchi qo'shish yoki mavjudini tahrirlash. */
export function useSaveTeacher(
  onDone?: () => void,
  onLogin?: (login: NewLogin) => void,
) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const { profile } = useAuth();

  return useMutation({
    // deno-lint-ignore no-explicit-any
    mutationFn: async (f: any) => {
      const common = {
        full_name: f.full_name.trim(),
        phone: f.phone.trim() || null,
        category: f.category.trim() || null,
        rate_factor: Number(f.rate_factor || 1),
        base_salary: Number(f.base_salary || 0),
        weekly_hours: Number(f.weekly_hours || 0),
        //  Bo'sh — maktabning umumiy sozlamasi ishlaydi.
        base_type: f.base_type || null,
      };

      // --- TAHRIRLASH ------------------------------------------
      // Filial ulushi (`teacher_branches.load_share`) bu yerda emas,
      // o'qituvchi kartochkasida boshqariladi: u yerda bir nechta
      // filial va ularning ulushi ko'rinadi (TZ 4.11.4).
      if (f.id) {
        const { error } = await supabase.from('teachers')
          .update({ ...common, is_active: f.is_active })
          .eq('id', f.id);
        if (error) throw error;
        await setClassTeacher(f.id, f.class_id || null, f.prev_class_id || null);
        return { id: f.id as string };
      }

      // --- YANGI -----------------------------------------------
      const { data: te, error } = await supabase.from('teachers').insert({
        school_id: profile!.school_id,
        ...common,
        hired_on: isoDate(),
      }).select('id').single();
      if (error) throw error;

      // TZ 4.11.4 — filial biriktirilmagan xodim uchun oylik xarajati
      // taqsimlanmaydi, shuning uchun kamida bitta filial majburiy.
      const { error: bErr } = await supabase.from('teacher_branches').insert({
        teacher_id: te.id,
        branch_id: f.branch_id,
        load_share: 1.0,
      });
      if (bErr) throw bErr;

      //  Sinf rahbarligi ixtiyoriy: fan o'qituvchisiga sinf
      //  biriktirilmaydi. Tanlangan bo'lsa darhol biriktiriladi —
      //  aks holda buni keyin sinflar sahifasidan qidirish kerak
      //  bo'lardi va odatda unutilib ketardi.
      await setClassTeacher(te.id, f.class_id || null, null);

      //  Tizimga kirish hisobi — ixtiyoriy, lekin standart holatda YOQIQ.
      if (f.create_login && f.phone) {
        const cred = await createTeacherLogin(
          te.id, common.full_name, f.phone, f.branch_id);
        return { ...te, credentials: cred };
      }

      return te;
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['teachers'] });
      qc.invalidateQueries({ queryKey: ['teacher'] });
      qc.invalidateQueries({ queryKey: ['classes'] });
      qc.invalidateQueries({ queryKey: ['class-options'] });
      toast.ok(t('ux.saved'));
      onDone?.();

      // deno-lint-ignore no-explicit-any
      const cred = (res as any)?.credentials as NewLogin | undefined;
      if (cred) onLogin?.(cred);
    },
    onError: (e) => toast.error((e as Error).message),
  });
}

export function TeacherModal({
  existing, onClose, branches, onSubmit, busy, error,
}: {
  // deno-lint-ignore no-explicit-any
  existing: any;
  onClose: () => void;
  branches: Array<{ id: string; name: string }>;
  // deno-lint-ignore no-explicit-any
  onSubmit: (f: any) => void;
  busy: boolean;
  error: string | null;
}) {
  const t = useT();

  //  O'qituvchi qaysi sinfning rahbari. Faol sinflar orasidan
  //  olinadi: arxivdagi o'tgan yil sinfi hisobga olinmasin.
  // deno-lint-ignore no-explicit-any
  const currentClass = (existing?.classes as any[] | undefined)
    ?.find((c) => c.is_active)?.id ?? null;

  const [f, setF] = useState({
    id: existing?.id as string | undefined,
    full_name: existing?.full_name ?? '',
    phone: existing?.phone ?? '',
    category: existing?.category ?? '',
    rate_factor: String(existing?.rate_factor ?? '1'),
    base_salary: existing ? String(existing.base_salary ?? '') : '',
    weekly_hours: existing ? String(existing.weekly_hours ?? '') : '',
    branch_id: branches[0]?.id ?? '',
    is_active: existing?.is_active ?? true,
    base_type: existing?.base_type ?? '',
    //  Yangi o'qituvchiga hisob ham yaratiladi — bu odatiy hol.
    create_login: !existing,
    //  Qaysi sinfga rahbar. Bo'sh — fan o'qituvchisi.
    class_id: currentClass ?? '',
    prev_class_id: currentClass ?? '',
  });

  const set = (k: string, v: string | boolean) =>
    setF((p) => ({ ...p, [k]: v }));

  return (
    <Modal
      open title={existing ? t('teachers.edit') : t('teachers.add')} onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" form="teacher-form" type="submit"
                  disabled={busy || !f.full_name
                    || (f.create_login && !isCompletePhone(f.phone))}>
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <form
        id="teacher-form"
        onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }}
        className="space-y-3"
      >
        <Field label={t('common.fullName')} required>
          <Input value={f.full_name} onChange={(e) => set('full_name', e.target.value)}
                 autoFocus required />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('common.phone')}>
            <PhoneInput value={f.phone} onChange={(v) => set('phone', v)} />
          </Field>
          <CatalogSelect
            kind="teacher_category"
            label={t('teachers.category')}
            hint={t('teachers.categoryHint')}
            value={f.category}
            onChange={(v) => set('category', v)}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('teachers.rateFactor')} hint={t('teachers.rateFactorHint')}>
            <Input type="number" step="0.05" min="0.05" max="3"
                   value={f.rate_factor}
                   onChange={(e) => set('rate_factor', e.target.value)} />
          </Field>
          <Field label={t('teachers.weeklyHours')}>
            <Input type="number" step="0.5" min="0" value={f.weekly_hours}
                   onChange={(e) => set('weekly_hours', e.target.value)} />
          </Field>
        </div>

        {/*  Maktabda bir vaqtning o'zida qat'iy oylik oladigan sinf
             rahbari ham, soatbay ishlaydigan to'garak rahbari ham
             bo'ladi. Ilgari tur butun maktabga bitta edi. */}
        <Field label={t('teachers.baseType')} hint={t('teachers.baseTypeHint')}>
          <Select value={f.base_type}
                  onChange={(e) => set('base_type', e.target.value)}>
            <option value="">{t('teachers.baseTypeDefault')}</option>
            <option value="fixed">{t('payroll.baseType.fixed')}</option>
            <option value="rate">{t('payroll.baseType.rate')}</option>
            <option value="hourly">{t('payroll.baseType.hourly')}</option>
            <option value="mixed">{t('payroll.baseType.mixed')}</option>
          </Select>
        </Field>

        <Field label={t('teachers.baseSalary')}
               hint={t('teachers.baseSalaryHint')}>
          <MoneyInput value={f.base_salary}
                      onChange={(e) => set('base_salary', e.target.value)} />
        </Field>

        {/* Kiritilgan raqamlardan oxirida qancha chiqishi DARHOL
            ko'rinadi — aks holda buni faqat oy oxirida bilib olinadi. */}
        <SalaryPreview
          baseSalary={f.base_salary}
          rateFactor={f.rate_factor}
          weeklyHours={f.weekly_hours}
          category={f.category}
          baseType={f.base_type}
        />

        <Field label={t('teachers.classTeacher')}
               hint={t('teachers.classTeacherHint')}>
          <ClassPicker
            value={f.class_id || null}
            branchId={f.branch_id || null}
            onChange={(c) => set('class_id', c.class_id ?? '')}
            allowCreate={false}
          />
        </Field>

        {!existing && (
          <label className="flex items-start gap-2 rounded-md border
            bg-[var(--bg-subtle)] px-3 py-2.5 text-[13px]">
            <input
              type="checkbox"
              checked={f.create_login}
              onChange={(e) => set('create_login', e.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              <span className="font-medium">{t('teachers.createLogin')}</span>
              <span className="block text-[12px] text-[var(--text-muted)]">
                {f.phone
                  ? t('teachers.createLoginHint')
                  : t('teachers.createLoginNeedPhone')}
              </span>
            </span>
          </label>
        )}

        {!existing && (
          <Field label={t('common.branch')} required
                 hint={t('teachers.branchHint')}>
            <Select value={f.branch_id}
                    onChange={(e) => set('branch_id', e.target.value)}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </Select>
          </Field>
        )}

        {existing && (
          <>
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={f.is_active}
                onChange={(e) => set('is_active', e.target.checked)}
                className="h-4 w-4"
              />
              {t('common.active')}
            </label>
            {!f.is_active && (
              <Notice tone="warn">{t('teachers.deactivateHint')}</Notice>
            )}
            <Notice tone="neutral">{t('teachers.branchesInCard')}</Notice>
          </>
        )}

        {error && <Notice tone="danger">{error}</Notice>}
      </form>
    </Modal>
  );
}
