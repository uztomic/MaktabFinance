// =====================================================================
//  Sozlamalardagi ma'lumotnomalar: kalendar, chegirmalar, sabablar.
//
//  Uchalasi ham TZ talabi va uchalasining bazasi tayyor edi, lekin
//  ekrani yo'q edi:
//
//  · TZ 4.5.5  — dam olish kunlari, bayramlar va ta'til kunlik xizmat
//                hisobiga kirmaydi. Busiz kunlar noto'g'ri sanaladi.
//  · TZ 12.2.3 — chegirma turlari (2-farzand, xodim farzandi...)
//  · TZ 12.3.5 — yo'qlik sababi pulga ta'sir qiladimi
// =====================================================================

import { type FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n, useT } from '@/i18n';
import { currentPeriod, date, isoDate, money, periodLabel, shiftPeriod } from '@/lib/format';
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Input, Loading,
  Modal, MoneyInput, Notice, Select, Table, Td, Th, Tr,
} from '@/ui';

// =====================================================================
//  1. KALENDAR (TZ 4.5.5)
// =====================================================================

type DayType = 'workday' | 'weekend' | 'holiday' | 'vacation';

const DAY_TONE: Record<DayType, 'ok' | 'neutral' | 'warn' | 'brand'> = {
  workday: 'ok',
  weekend: 'neutral',
  holiday: 'warn',
  vacation: 'brand',
};

export function CalendarSettings({ editable }: { editable: boolean }) {
  const t = useT();
  const { lang } = useI18n();
  const qc = useQueryClient();
  const { branchId, branches, profile } = useAuth();

  const [period, setPeriod] = useState(currentPeriod());
  const [adding, setAdding] = useState(false);

  const monthEnd = useMemo(() => {
    const d = new Date(period);
    return isoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  }, [period]);

  const rows = useQuery({
    queryKey: ['calendar', period],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('calendar_days')
        .select('school_id, branch_id, day, day_type, name')
        .gte('day', period)
        .lte('day', monthEnd)
        .order('day');
      if (error) throw error;
      return data ?? [];
    },
  });

  // Ish kunlari sonini bazadagi mantiq bilan hisoblaymiz — panelda
  // takrorlamaymiz, aks holda ikkalasi bir-biridan uzilib ketadi.
  const workdays = useQuery({
    queryKey: ['workdays', period, branchId],
    enabled: !!branchId || branches.length === 1,
    queryFn: async () => {
      const b = branchId ?? branches[0]?.id;
      if (!b) return null;
      const { data, error } = await supabase.rpc('report_service_usage', {
        p_from: period, p_to: monthEnd, p_branch_id: b,
      });
      if (error) throw error;
      return data;
    },
  });

  const add = useMutation({
    mutationFn: async (f: {
      from: string; to: string; day_type: DayType;
      name: string; branch_id: string | null;
    }) => {
      const days: string[] = [];
      const cur = new Date(f.from);
      const end = new Date(f.to || f.from);
      while (cur <= end) {
        days.push(isoDate(cur));
        cur.setDate(cur.getDate() + 1);
      }
      if (days.length > 200) throw new Error('Davr juda uzun (200 kundan ko\'p)');

      const { error } = await supabase.from('calendar_days').upsert(
        days.map((d) => ({
          school_id: profile!.school_id,
          branch_id: f.branch_id,
          day: d,
          day_type: f.day_type,
          name: f.name.trim() || null,
        })),
      );
      if (error) throw error;
      return days.length;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar'] });
      qc.invalidateQueries({ queryKey: ['workdays'] });
      setAdding(false);
    },
  });

  const remove = useMutation({
    mutationFn: async (v: { day: string; branch_id: string | null }) => {
      let q = supabase.from('calendar_days').delete().eq('day', v.day);
      q = v.branch_id
        ? q.eq('branch_id', v.branch_id)
        : q.is('branch_id', null);
      const { error } = await q;
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar'] });
      qc.invalidateQueries({ queryKey: ['workdays'] });
    },
  });

  if (rows.isLoading) return <Loading />;
  if (rows.error) return <ErrorState message={(rows.error as Error).message} />;

  return (
    <div className="space-y-4">
      <Notice tone="neutral">{t('cal.hint')}</Notice>

      <Card
        title={periodLabel(period, lang)}
        action={
          <div className="flex gap-1.5">
            <Button size="sm" onClick={() => setPeriod(shiftPeriod(period, -1))}>←</Button>
            <Button size="sm" onClick={() => setPeriod(shiftPeriod(period, 1))}>→</Button>
            {editable && (
              <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
                + {t('cal.addRange')}
              </Button>
            )}
          </div>
        }
        padded={false}
      >
        {(rows.data?.length ?? 0) === 0
          ? (
            <EmptyState
              title={t('common.empty')}
              hint="Bu oyda istisno kun belgilanmagan — dushanba-juma ish kuni hisoblanadi."
            />
          )
          : (
            <Table>
              <thead>
                <tr>
                  <Th>{t('cal.day')}</Th>
                  <Th>{t('cal.type')}</Th>
                  <Th>{t('cal.name')}</Th>
                  <Th>{t('common.branch')}</Th>
                  <Th align="right">{t('common.actions')}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.data!.map((d, i) => (
                  <Tr key={i}>
                    <Td mono>{date(d.day, lang)}</Td>
                    <Td>
                      <Badge tone={DAY_TONE[d.day_type as DayType]}>
                        {t(`cal.type.${d.day_type}`)}
                      </Badge>
                    </Td>
                    <Td className="text-[var(--text-muted)]">{d.name ?? '—'}</Td>
                    <Td className="text-[var(--text-muted)]">
                      {d.branch_id
                        ? branches.find((b) => b.id === d.branch_id)?.name ?? '—'
                        : t('cal.allBranches')}
                    </Td>
                    <Td align="right">
                      {editable && (
                        <button
                          type="button"
                          onClick={() => remove.mutate({
                            day: d.day, branch_id: d.branch_id,
                          })}
                          className="flex h-6 w-6 items-center justify-center rounded
                            text-[var(--text-faint)] hover:bg-[var(--danger-bg)]
                            hover:text-[var(--danger)]"
                        >
                          ✕
                        </button>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
      </Card>

      {workdays.data && (
        <p className="text-[12px] text-[var(--text-faint)]">
          {t('cal.workdaysInMonth')}: kunlik xizmatlar shu kunlar bo'yicha
          hisoblanadi.
        </p>
      )}

      <CalendarModal
        open={adding}
        onClose={() => setAdding(false)}
        branches={branches}
        onSubmit={(f) => add.mutate(f)}
        busy={add.isPending}
        error={add.error ? (add.error as Error).message : null}
      />
    </div>
  );
}

function CalendarModal({
  open, onClose, branches, onSubmit, busy, error,
}: {
  open: boolean;
  onClose: () => void;
  branches: Array<{ id: string; name: string }>;
  // deno-lint-ignore no-explicit-any
  onSubmit: (f: any) => void;
  busy: boolean;
  error: string | null;
}) {
  const t = useT();
  const [f, setF] = useState({
    from: isoDate(),
    to: '',
    day_type: 'holiday' as DayType,
    name: '',
    branch_id: '',
  });
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  return (
    <Modal
      open={open} title={t('cal.addRange')} onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" form="add-cal" type="submit"
                  disabled={busy || !f.from}>
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <form
        id="add-cal"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          onSubmit({ ...f, branch_id: f.branch_id || null, to: f.to || f.from });
        }}
        className="space-y-3"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('cal.from')} required>
            <Input type="date" value={f.from}
                   onChange={(e) => set('from', e.target.value)} autoFocus required />
          </Field>
          <Field label={t('cal.to')} hint="Bo'sh = bitta kun">
            <Input type="date" value={f.to} min={f.from}
                   onChange={(e) => set('to', e.target.value)} />
          </Field>
        </div>

        <Field label={t('cal.type')} required>
          <Select value={f.day_type}
                  onChange={(e) => set('day_type', e.target.value)}>
            <option value="holiday">{t('cal.type.holiday')}</option>
            <option value="vacation">{t('cal.type.vacation')}</option>
            <option value="weekend">{t('cal.type.weekend')}</option>
            <option value="workday">{t('cal.type.workday')}</option>
          </Select>
        </Field>

        <Field label={t('cal.name')} hint="Masalan: Navro'z, Qish ta'tili">
          <Input value={f.name} onChange={(e) => set('name', e.target.value)} />
        </Field>

        {branches.length > 1 && (
          <Field label={t('common.branch')}>
            <Select value={f.branch_id}
                    onChange={(e) => set('branch_id', e.target.value)}>
              <option value="">{t('cal.allBranches')}</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {t('cal.branchScope')}: {b.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {error && <Notice tone="danger">{error}</Notice>}
      </form>
    </Modal>
  );
}

// =====================================================================
//  2. CHEGIRMA TURLARI (TZ 12.2.3, 12.2.4)
// =====================================================================

export function DiscountSettings({ editable }: { editable: boolean }) {
  const t = useT();
  const { lang } = useI18n();
  const qc = useQueryClient();
  const { profile } = useAuth();
  const [adding, setAdding] = useState(false);

  const rows = useQuery({
    queryKey: ['discount-types-all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('discount_types')
        .select('id, code, name, kind, value, is_active')
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });

  const save = useMutation({
    mutationFn: async (f: {
      id?: string; code: string; name: string;
      kind: 'percent' | 'amount'; value: string;
    }) => {
      if (f.id) {
        const { error } = await supabase.from('discount_types')
          .update({ name: f.name.trim(), kind: f.kind, value: Number(f.value) })
          .eq('id', f.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('discount_types').insert({
          school_id: profile!.school_id,
          code: f.code.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'),
          name: f.name.trim(),
          kind: f.kind,
          value: Number(f.value),
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['discount-types-all'] });
      qc.invalidateQueries({ queryKey: ['discount-types'] });
      setAdding(false);
    },
  });

  const toggle = useMutation({
    mutationFn: async (v: { id: string; active: boolean }) => {
      const { error } = await supabase.from('discount_types')
        .update({ is_active: v.active }).eq('id', v.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['discount-types-all'] }),
  });

  if (rows.isLoading) return <Loading />;

  return (
    <div className="space-y-4">
      <Notice tone="neutral">{t('disc.hint')}</Notice>

      <Card
        title={t('disc.title')}
        action={editable && (
          <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
            + {t('disc.add')}
          </Button>
        )}
        padded={false}
      >
        {(rows.data?.length ?? 0) === 0 ? <EmptyState /> : (
          <Table>
            <thead>
              <tr>
                <Th>{t('common.name')}</Th>
                <Th>{t('pf.row.code')}</Th>
                <Th align="right">{t('pf.row.value')}</Th>
                <Th>{t('common.status')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.data!.map((d) => (
                <Tr key={d.id}>
                  <Td className="font-medium">{d.name}</Td>
                  <Td mono className="text-[var(--text-muted)]">{d.code}</Td>
                  <Td align="right" mono>
                    {d.kind === 'percent'
                      ? `${d.value}%`
                      : money(d.value, lang)}
                  </Td>
                  <Td>
                    {editable
                      ? (
                        <button
                          type="button"
                          onClick={() => toggle.mutate({
                            id: d.id, active: !d.is_active,
                          })}
                        >
                          <Badge tone={d.is_active ? 'ok' : 'neutral'}>
                            {d.is_active ? t('common.active') : t('common.inactive')}
                          </Badge>
                        </button>
                      )
                      : (
                        <Badge tone={d.is_active ? 'ok' : 'neutral'}>
                          {d.is_active ? t('common.active') : t('common.inactive')}
                        </Badge>
                      )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <DiscountModal
        open={adding}
        onClose={() => setAdding(false)}
        onSubmit={(f) => save.mutate(f)}
        busy={save.isPending}
        error={save.error ? (save.error as Error).message : null}
      />
    </div>
  );
}

function DiscountModal({
  open, onClose, onSubmit, busy, error,
}: {
  open: boolean;
  onClose: () => void;
  // deno-lint-ignore no-explicit-any
  onSubmit: (f: any) => void;
  busy: boolean;
  error: string | null;
}) {
  const t = useT();
  const [f, setF] = useState({
    code: '', name: '', kind: 'percent' as 'percent' | 'amount', value: '',
  });
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  return (
    <Modal
      open={open} title={t('disc.add')} onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" form="add-disc" type="submit"
                  disabled={busy || !f.name || !f.value}>
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <form
        id="add-disc"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          onSubmit({ ...f, code: f.code || f.name });
        }}
        className="space-y-3"
      >
        <Field label={t('common.name')} required>
          <Input value={f.name} onChange={(e) => set('name', e.target.value)}
                 placeholder="2-farzand" autoFocus required />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('pf.row.type')} required>
            <Select value={f.kind} onChange={(e) => set('kind', e.target.value)}>
              <option value="percent">{t('pf.row.percent')}</option>
              <option value="amount">{t('pf.row.fixed')}</option>
            </Select>
          </Field>
          <Field label={t('pf.row.value')} required>
            {f.kind === 'percent'
              ? (
                <Input type="number" min={0} max={100} step={0.5}
                       value={f.value}
                       onChange={(e) => set('value', e.target.value)}
                       className="num text-right" required />
              )
              : (
                <MoneyInput value={f.value}
                            onChange={(e) => set('value', e.target.value)} required />
              )}
          </Field>
        </div>

        {error && <Notice tone="danger">{error}</Notice>}
      </form>
    </Modal>
  );
}

// =====================================================================
//  3. YO'QLIK SABABLARI (TZ 12.3.5)
// =====================================================================

export function ReasonSettings({ editable }: { editable: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const { profile } = useAuth();
  const [adding, setAdding] = useState(false);

  const rows = useQuery({
    queryKey: ['absence-reasons-all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('absence_reasons')
        .select('id, code, name, deducts, is_active, sort_order')
        .order('sort_order');
      if (error) throw error;
      return data ?? [];
    },
  });

  const add = useMutation({
    mutationFn: async (f: { name: string; deducts: boolean }) => {
      const code = f.name.trim().toLowerCase()
        .replace(/[^a-z0-9]+/g, '_') || `r_${Date.now()}`;
      const { error } = await supabase.from('absence_reasons').insert({
        school_id: profile!.school_id,
        code,
        name: f.name.trim(),
        deducts: f.deducts,
        sort_order: 500,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['absence-reasons-all'] });
      qc.invalidateQueries({ queryKey: ['absence-reasons'] });
      setAdding(false);
    },
  });

  const toggleDeducts = useMutation({
    mutationFn: async (v: { id: string; deducts: boolean }) => {
      const { error } = await supabase.from('absence_reasons')
        .update({ deducts: v.deducts }).eq('id', v.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['absence-reasons-all'] });
      qc.invalidateQueries({ queryKey: ['absence-reasons'] });
    },
  });

  if (rows.isLoading) return <Loading />;

  return (
    <div className="space-y-4">
      <Notice tone="neutral">{t('reason.hint')}</Notice>

      <Card
        title={t('reason.title')}
        action={editable && (
          <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
            + {t('reason.add')}
          </Button>
        )}
        padded={false}
      >
        {(rows.data?.length ?? 0) === 0 ? <EmptyState /> : (
          <Table>
            <thead>
              <tr>
                <Th>{t('common.name')}</Th>
                <Th>{t('pf.row.code')}</Th>
                <Th>{t('reason.deducts')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.data!.map((r) => (
                <Tr key={r.id}>
                  <Td className="font-medium">{r.name}</Td>
                  <Td mono className="text-[var(--text-muted)]">{r.code}</Td>
                  <Td>
                    {editable
                      ? (
                        <button
                          type="button"
                          onClick={() => toggleDeducts.mutate({
                            id: r.id, deducts: !r.deducts,
                          })}
                        >
                          <Badge tone={r.deducts ? 'ok' : 'warn'}>
                            {r.deducts ? t('reason.deducts') : t('reason.charges')}
                          </Badge>
                        </button>
                      )
                      : (
                        <Badge tone={r.deducts ? 'ok' : 'warn'}>
                          {r.deducts ? t('reason.deducts') : t('reason.charges')}
                        </Badge>
                      )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal
        open={adding} title={t('reason.add')} onClose={() => setAdding(false)}
        footer={
          <>
            <Button onClick={() => setAdding(false)}>{t('common.cancel')}</Button>
            <Button variant="primary" form="add-reason" type="submit"
                    disabled={add.isPending}>
              {add.isPending ? t('common.saving') : t('common.save')}
            </Button>
          </>
        }
      >
        <ReasonForm
          onSubmit={(f) => add.mutate(f)}
          error={add.error ? (add.error as Error).message : null}
        />
      </Modal>
    </div>
  );
}

function ReasonForm({
  onSubmit, error,
}: {
  onSubmit: (f: { name: string; deducts: boolean }) => void;
  error: string | null;
}) {
  const t = useT();
  const [name, setName] = useState('');
  const [deducts, setDeducts] = useState(true);

  return (
    <form
      id="add-reason"
      onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit({ name, deducts }); }}
      className="space-y-3"
    >
      <Field label={t('common.name')} required>
        <Input value={name} onChange={(e) => setName(e.target.value)}
               placeholder="Kasallik" autoFocus required />
      </Field>

      <label className="flex items-start gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={deducts}
          onChange={(e) => setDeducts(e.target.checked)}
          className="mt-0.5 h-4 w-4"
        />
        <span>
          <strong>{t('reason.deducts')}</strong>
          <span className="block text-[12px] text-[var(--text-muted)]">
            Belgilansa — bu sabab bilan yo'q kun uchun pul olinmaydi.
            Belgilanmasa — kun hisoblanadi (masalan sababsiz).
          </span>
        </span>
      </label>

      {error && <Notice tone="danger">{error}</Notice>}
    </form>
  );
}
