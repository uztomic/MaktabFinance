// =====================================================================
//  Sozlamalar.
//
//  TZ 4.11.10 — "Formula parametrlari KODGA YOZILMAYDI. Stavkalar,
//  tariflar, ustamalar foizi va ushlanma stavkalari SOZLAMADA
//  saqlanadi va maktab bo'yicha farq qilishi mumkin."
//
//  Aynan shu sahifa o'sha talabni bajaradi: buxgalter formulani
//  bergach dasturchi kerak emas — qiymatlar shu yerdan o'zgartiriladi
//  va keyingi hisoblashda darhol qo'llanadi.
//
//  TZ 4.6.1.3 — kunlik xizmat farqini ko'chirish usuli ham shu yerda.
// =====================================================================

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useT } from '@/i18n';
import PayrollFormula from './settings/PayrollFormula';
import {
  CalendarSettings, DiscountSettings, ReasonSettings,
} from './settings/Catalogs';
import {
  Button, Card, ErrorState, Field, Input, Loading, Notice, PageHeader, Select,
} from '@/ui';

type Tab = 'finance' | 'payroll' | 'messaging'
  | 'calendar' | 'discounts' | 'reasons';

export default function Settings() {
  const t = useT();
  const { can, mayWrite, profile } = useAuth();
  const [tab, setTab] = useState<Tab>('finance');

  if (!can('users.manage')) {
    return <Notice tone="danger">{t('common.noAccess')}</Notice>;
  }

  const TABS: Array<{ id: Tab; label: string }> = [
    { id: 'finance', label: t('settings.finance') },
    { id: 'payroll', label: t('settings.payroll') },
    { id: 'messaging', label: t('settings.messaging') },
    { id: 'calendar', label: t('cal.title') },
    { id: 'discounts', label: t('disc.title') },
    { id: 'reasons', label: t('reason.title') },
  ];

  return (
    <>
      <PageHeader title={t('settings.title')} subtitle={profile?.school_name} />

      <div className="mb-4 flex gap-1 border-b">
        {TABS.map((x) => (
          <button
            key={x.id}
            onClick={() => setTab(x.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition-colors
              ${tab === x.id
                ? 'border-brand-700 text-[var(--text)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'}`}
          >
            {x.label}
          </button>
        ))}
      </div>

      {tab === 'payroll' && <PayrollFormula editable={mayWrite('payroll.manage')} />}
      {tab === 'calendar' && <CalendarSettings editable={mayWrite('services.manage')} />}
      {tab === 'discounts' && <DiscountSettings editable={mayWrite('services.manage')} />}
      {tab === 'reasons' && <ReasonSettings editable={mayWrite('services.manage')} />}
      {(tab === 'finance' || tab === 'messaging') && (
        <SchoolSettings group={tab} editable={mayWrite('users.manage')} />
      )}
    </>
  );
}

// =====================================================================
//  Moliya va xabar sozlamalari (school_settings)
// =====================================================================

interface SettingDef {
  key: string;
  labelKey: string;
  /** Izoh matnining tarjima kaliti. */
  hintKey: string;
  kind: 'number' | 'select' | 'json';
  options?: Array<{ value: string; labelKey: string }>;
  min?: number;
  max?: number;
}

const FINANCE: SettingDef[] = [
  {
    key: 'academic_year_start_month',
    labelKey: 'settings.academicYearStart',
    hintKey: 'settings.academicYearStart.hint',
    kind: 'number', min: 1, max: 12,
  },
  {
    key: 'billing.daily_diff_method',
    labelKey: 'settings.dailyDiffMethod',
    hintKey: 'settings.dailyDiffMethod.hint',
    kind: 'select',
    options: [
      { value: 'recalculate', labelKey: 'settings.dailyDiffMethod.recalculate' },
      { value: 'carryover', labelKey: 'settings.dailyDiffMethod.carryover' },
    ],
  },
  {
    key: 'files.proof_retention_days',
    labelKey: 'settings.proofRetention',
    hintKey: 'settings.proofRetention.hint',
    kind: 'number', min: 7, max: 3650,
  },
  {
    key: 'files.stale_proof_days',
    labelKey: 'settings.staleProof',
    hintKey: 'settings.staleProof.hint',
    kind: 'number', min: 1, max: 365,
  },
];

const MESSAGING: SettingDef[] = [
  {
    key: 'messaging.reminder_days_before',
    labelKey: 'settings.reminderDays',
    hintKey: 'settings.reminderDays.hint',
    kind: 'number', min: 0, max: 30,
  },
  {
    key: 'messaging.quiet_hours',
    labelKey: 'settings.quietHours',
    hintKey: 'settings.quietHours.hint',
    kind: 'json',
  },
];

function SchoolSettings({
  group, editable,
}: {
  group: 'finance' | 'messaging';
  editable: boolean;
}) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const defs = group === 'finance' ? FINANCE : MESSAGING;

  const rows = useQuery({
    queryKey: ['school-settings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('school_settings')
        .select('key, value, note');
      if (error) throw error;
      return new Map((data ?? []).map((r) => [r.key, r]));
    },
  });

  const save = useMutation({
    mutationFn: async (v: { key: string; value: unknown }) => {
      const { error } = await supabase.from('school_settings').upsert({
        school_id: profile!.school_id,
        key: v.key,
        value: v.value as never,
        updated_by: profile!.id,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school-settings'] }),
  });

  if (rows.isLoading) return <Loading />;
  if (rows.error) {
    return <ErrorState message={(rows.error as Error).message} />;
  }

  return (
    <Card>
      <div className="space-y-5">
        {defs.map((d) => (
          <SettingRow
            key={d.key}
            def={d}
            current={rows.data?.get(d.key)?.value}
            editable={editable}
            onSave={(value) => save.mutate({ key: d.key, value })}
            busy={save.isPending}
          />
        ))}
      </div>
      {save.error && (
        <div className="mt-4">
          <Notice tone="danger">{(save.error as Error).message}</Notice>
        </div>
      )}
    </Card>
  );
}

function SettingRow({
  def, current, editable, onSave, busy,
}: {
  def: SettingDef;
  current: unknown;
  editable: boolean;
  onSave: (v: unknown) => void;
  busy: boolean;
}) {
  const t = useT();
  const initial = def.kind === 'json'
    ? JSON.stringify(current ?? {}, null, 0)
    : String(current ?? '').replace(/^"|"$/g, '');

  const [value, setValue] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const dirty = value !== initial;

  function submit() {
    setErr(null);
    try {
      const parsed = def.kind === 'json'
        ? JSON.parse(value)
        : def.kind === 'number'
        ? Number(value)
        : value;
      onSave(parsed);
    } catch {
      setErr('JSON formati noto\'g\'ri');
    }
  }

  const label = t(def.labelKey);

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-[16rem] flex-1">
        <Field label={label} hint={t(def.hintKey)} error={err ?? undefined}>
          {def.kind === 'select'
            ? (
              <Select value={value} onChange={(e) => setValue(e.target.value)}
                      disabled={!editable}>
                {def.options!.map((o) => (
                  <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
                ))}
              </Select>
            )
            : (
              <Input
                type={def.kind === 'number' ? 'number' : 'text'}
                min={def.min} max={def.max}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                disabled={!editable}
                className={def.kind === 'json' ? 'font-mono text-[12px]' : ''}
              />
            )}
        </Field>
      </div>
      {editable && (
        <Button variant={dirty ? 'primary' : 'secondary'} onClick={submit}
                disabled={!dirty || busy}>
          {t('common.save')}
        </Button>
      )}
    </div>
  );
}
