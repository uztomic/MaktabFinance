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
import { useSearchParams } from 'react-router-dom';
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
  //  Tanlangan bo'lim manzilda — "Sozlamalar → Oylik" ga havola berish
  //  va sahifa yangilanganda joyida qolish uchun.
  const [params, setParams] = useSearchParams();
  const ALL: Tab[] = ['finance', 'payroll', 'messaging', 'calendar', 'discounts', 'reasons'];
  const raw = params.get('b') as Tab | null;
  const tab: Tab = raw && ALL.includes(raw) ? raw : 'finance';
  const setTab = (x: Tab) => setParams({ b: x }, { replace: true });

  if (!can('users.manage')) {
    return <Notice tone="danger">{t('common.noAccess')}</Notice>;
  }

  //  Har bo'limda bir qatorli izoh: nima uchun kerak. Ilgari faqat
  //  nomlar bor edi va "Sabablar" yoki "Moliya" ichida nima borligini
  //  ochib ko'rmaguncha bilib bo'lmasdi.
  const TABS: Array<{ id: Tab; label: string; hint: string; icon: string }> = [
    { id: 'finance', label: t('settings.finance'), hint: t('settings.hint.finance'), icon: '💳' },
    { id: 'payroll', label: t('settings.payroll'), hint: t('settings.hint.payroll'), icon: '🧮' },
    { id: 'messaging', label: t('settings.messaging'), hint: t('settings.hint.messaging'), icon: '✉️' },
    { id: 'calendar', label: t('cal.title'), hint: t('settings.hint.calendar'), icon: '📅' },
    { id: 'discounts', label: t('disc.title'), hint: t('settings.hint.discounts'), icon: '🏷️' },
    { id: 'reasons', label: t('reason.title'), hint: t('settings.hint.reasons'), icon: '📝' },
  ];

  return (
    <>
      <PageHeader title={t('settings.title')} subtitle={profile?.school_name} />

      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        {TABS.map((x) => (
          <button
            key={x.id}
            type="button"
            onClick={() => setTab(x.id)}
            aria-pressed={tab === x.id}
            className={`rounded-lg border px-3 py-2.5 text-left transition-colors
              ${tab === x.id
                ? 'border-[var(--sel-border)] bg-[var(--sel-bg)]'
                : 'hover:bg-[var(--bg-subtle)]'}`}
          >
            <div className="flex items-center gap-1.5 text-[13px] font-semibold">
              <span aria-hidden>{x.icon}</span>{x.label}
            </div>
            <div className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-[var(--text-muted)]">
              {x.hint}
            </div>
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
  kind: 'number' | 'select' | 'json' | 'hours';
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
    //  Kundalik davomat xabari. Maktab uni o'chirib qo'yishi mumkin —
    //  masalan bog'chada ota-ona bolani o'zi olib keladi va xabar
    //  ortiqcha bo'ladi.
    key: 'messaging.attendance_notice',
    labelKey: 'settings.attendanceNotice',
    hintKey: 'settings.attendanceNotice.hint',
    kind: 'select',
    options: [
      { value: 'true', labelKey: 'common.yes' },
      { value: 'false', labelKey: 'common.no' },
    ],
  },
  {
    key: 'messaging.quiet_hours',
    labelKey: 'settings.quietHours',
    hintKey: 'settings.quietHours.hint',
    //  Ilgari xom JSON edi: {"to":8,"from":20} — buxgalter uchun
    //  tushunarsiz va bitta qavs xatosi sozlamani buzardi.
    kind: 'hours',
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
            onSave={(value) => save.mutateAsync({ key: d.key, value })}
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

/** `{"from":20,"to":8}` → soatlar; buzuq qiymatda standart 20→8. */
function readHours(raw: string): { from: number; to: number } {
  try {
    const v = JSON.parse(raw) as { from?: unknown; to?: unknown };
    const ok = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 23;
    return { from: ok(v.from) ? v.from as number : 20, to: ok(v.to) ? v.to as number : 8 };
  } catch {
    return { from: 20, to: 8 };
  }
}

function SettingRow({
  def, current, editable, onSave, busy,
}: {
  def: SettingDef;
  current: unknown;
  editable: boolean;
  onSave: (v: unknown) => Promise<void>;
  busy: boolean;
}) {
  const t = useT();
  const initial = def.kind === 'hours'
    //  Kalitlar tartibi bazada boshqacha bo'lishi mumkin — bir xil
    //  ko'rinishga keltiriladi, aks holda saqlangandan keyin ham
    //  "o'zgargan" deb turaverardi.
    ? JSON.stringify(readHours(JSON.stringify(current ?? {})))
    : def.kind === 'json'
    ? JSON.stringify(current ?? {}, null, 0)
    : String(current ?? '').replace(/^"|"$/g, '');

  const [value, setValue] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const dirty = value !== initial;

  const [saved, setSaved] = useState(false);

  //  RAQAM TEKSHIRUVI. `min`/`max` faqat brauzerga ishora — foydalanuvchi
  //  baribir "13" yoki bo'sh maydonni yuborishi mumkin edi va u
  //  bazaga yozilardi (`Number('')` = 0). Masalan o'quv yili boshi
  //  13-oy bo'lib qolsa, hisoblanma davrlari buziladi.
  function submit() {
    setErr(null);
    setSaved(false);
    let parsed: unknown;
    if (def.kind === 'hours') {
      const h = readHours(value);
      if (h.from === h.to) {
        setErr(t('settings.err.hoursSame'));
        return;
      }
      parsed = h;
    } else if (def.kind === 'json') {
      try {
        parsed = JSON.parse(value);
      } catch {
        setErr(t('settings.err.json'));
        return;
      }
    } else if (def.kind === 'number') {
      const raw = value.trim().replace(',', '.');
      const n = Number(raw);
      if (raw === '' || !Number.isFinite(n)) {
        setErr(t('settings.err.number'));
        return;
      }
      if (!Number.isInteger(n)) {
        setErr(t('settings.err.integer'));
        return;
      }
      if ((def.min !== undefined && n < def.min) || (def.max !== undefined && n > def.max)) {
        setErr(t('settings.err.range', { min: def.min ?? '—', max: def.max ?? '—' }));
        return;
      }
      parsed = n;
    } else {
      parsed = value;
    }
    //  "Saqlandi" faqat server tasdiqlagandan keyin.
    onSave(parsed).then(() => setSaved(true)).catch(() => { /* xato pastda ko'rsatiladi */ });
  }

  const label = t(def.labelKey);

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-[16rem] flex-1">
        <Field label={label}
               hint={saved && !dirty ? `✓ ${t('settings.saved')}` : t(def.hintKey)}
               error={err ?? undefined}>
          {def.kind === 'hours'
            ? (
              <div className="flex items-center gap-2">
                {(['from', 'to'] as const).map((k) => (
                  <label key={k} className="flex items-center gap-1.5 text-[13px]">
                    <span className="text-[var(--text-muted)]">{t(`settings.hours.${k}`)}</span>
                    <Select
                      value={String(readHours(value)[k])}
                      disabled={!editable}
                      className="w-24"
                      onChange={(e) => {
                        const h = { ...readHours(value), [k]: Number(e.target.value) };
                        setValue(JSON.stringify(h));
                        setErr(null);
                        setSaved(false);
                      }}
                    >
                      {Array.from({ length: 24 }, (_, i) => (
                        <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                      ))}
                    </Select>
                  </label>
                ))}
              </div>
            )
            : def.kind === 'select'
            ? (
              <Select value={value} onChange={(e) => { setValue(e.target.value); setSaved(false); }}
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
                onChange={(e) => {
                  setValue(e.target.value);
                  setErr(null);
                  setSaved(false);
                }}
                disabled={!editable}
                aria-invalid={!!err}
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
