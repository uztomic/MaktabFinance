// =====================================================================
//  Qo'shimcha xizmatlar (TZ 4.4).
//
//  TZ 4.4.1 — maktab xodimi yangi xizmat turini DASTURCHI ISHTIROKISIZ
//  qo'sha oladi. Shuning uchun hisoblash turi ham shu yerdan tanlanadi.
//
//  TZ 4.4.5 — narx o'zgarganda eski narx TARIXDA saqlanadi va o'tgan
//  davrlarga ta'sir qilmaydi. Shuning uchun narxni "tahrirlash" emas,
//  YANGI NARX QO'SHISH amali bor: eski yozuv yopiladi, yangisi ochiladi.
// =====================================================================

import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n, useT } from '@/i18n';
import { date, isoDate, money } from '@/lib/format';
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Input, Loading,
  Modal, MoneyInput, Notice, PageHeader, Select, Table, Td, Th, Tr,
} from '@/ui';
import { useToast } from '@/ui/Feedback';

type BillingType = 'monthly_fixed' | 'daily' | 'one_time';

export default function Services() {
  const t = useT();
  const { lang } = useI18n();
  const qc = useQueryClient();
  const { branchId, branches, mayWrite, can, profile } = useAuth();

  const toast = useToast();
  const [adding, setAdding] = useState(false);
  // deno-lint-ignore no-explicit-any
  const [editing, setEditing] = useState<any>(null);
  const [historyFor, setHistoryFor] = useState<
    { id: string; name: string } | null
  >(null);
  const [priceFor, setPriceFor] = useState<
    { id: string; name: string; current: number | null } | null
  >(null);

  const canEdit = mayWrite('services.manage');

  const list = useQuery({
    queryKey: ['services', branchId],
    queryFn: async () => {
      let q = supabase
        .from('services')
        .select('id, code, name, billing_type, is_active, branch_id, branches(name), service_prices(price, valid_from, valid_to)')
        .is('deleted_at', null)
        .order('sort_order')
        .order('name');
      if (branchId) q = q.eq('branch_id', branchId);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const subscribers = useQuery({
    queryKey: ['service-subscribers', branchId],
    queryFn: async () => {
      const today = isoDate();
      const { data, error } = await supabase
        .from('student_services')
        .select('service_id, ends_on')
        .lte('starts_on', today);
      if (error) throw error;
      const counts = new Map<string, number>();
      for (const r of data ?? []) {
        if (r.ends_on && r.ends_on < today) continue;
        counts.set(r.service_id, (counts.get(r.service_id) ?? 0) + 1);
      }
      return counts;
    },
  });

  const save = useMutation({
    mutationFn: async (f: {
      id?: string;
      code: string; name: string; billing_type: BillingType;
      branch_id: string; price: string; is_active: boolean;
    }) => {
      // TAHRIRLASH. Narx bu yerda o'zgarmaydi — u tarixli jadvalda
      // saqlanadi va alohida "Narx" oynasidan qo'shiladi (TZ 4.4.5).
      if (f.id) {
        const { error } = await supabase.from('services').update({
          code: f.code.trim().toLowerCase(),
          name: f.name.trim(),
          billing_type: f.billing_type,
          is_active: f.is_active,
        }).eq('id', f.id);
        if (error) throw error;
        return { id: f.id };
      }

      const { data: svc, error } = await supabase.from('services').insert({
        school_id: profile!.school_id,
        branch_id: f.branch_id,
        code: f.code.trim().toLowerCase(),
        name: f.name.trim(),
        billing_type: f.billing_type,
      }).select('id').single();
      if (error) throw error;

      if (f.price) {
        const { error: pErr } = await supabase.from('service_prices').insert({
          school_id: profile!.school_id,
          service_id: svc.id,
          price: Number(f.price),
          valid_from: isoDate(),
          created_by: profile!.id,
        });
        if (pErr) throw pErr;
      }
      return svc;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['services'] });
      toast.ok(t('ux.saved'));
      setAdding(false);
      setEditing(null);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  // TZ 4.4.5 — yangi narx: eskisini yopamiz, yangisini ochamiz.
  const setPrice = useMutation({
    mutationFn: async (f: { service_id: string; price: number; from: string }) => {
      const prevEnd = new Date(f.from);
      prevEnd.setDate(prevEnd.getDate() - 1);

      const { error: closeErr } = await supabase
        .from('service_prices')
        .update({ valid_to: isoDate(prevEnd) })
        .eq('service_id', f.service_id)
        .is('valid_to', null);
      if (closeErr) throw closeErr;

      const { error } = await supabase.from('service_prices').insert({
        school_id: profile!.school_id,
        service_id: f.service_id,
        price: f.price,
        valid_from: f.from,
        created_by: profile!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['services'] });
      toast.ok(t('services.priceSaved'));
      setPriceFor(null);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (!can('services.manage')) {
    return <Notice tone="danger">{t('common.noAccess')}</Notice>;
  }
  if (list.isLoading) return <Loading />;
  if (list.error) {
    return <ErrorState message={(list.error as Error).message}
                       onRetry={() => list.refetch()} />;
  }

  /** Bugun amal qilayotgan narx. */
  // deno-lint-ignore no-explicit-any
  function currentPrice(s: any): { price: number; from: string } | null {
    const today = isoDate();
    const rows = (s.service_prices ?? []) as Array<
      { price: number; valid_from: string; valid_to: string | null }
    >;
    const active = rows
      .filter((p) => p.valid_from <= today && (!p.valid_to || p.valid_to >= today))
      .sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0];
    return active ? { price: Number(active.price), from: active.valid_from } : null;
  }

  return (
    <>
      <PageHeader
        title={t('services.title')}
        subtitle={t('common.showing', { count: list.data?.length ?? 0 })}
        actions={canEdit && (
          <Button variant="primary" onClick={() => setAdding(true)}>
            {t('services.add')}
          </Button>
        )}
      />

      <Card padded={false}>
        {(list.data?.length ?? 0) === 0
          ? (
            <EmptyState
              action={canEdit && (
                <Button onClick={() => setAdding(true)}>{t('services.add')}</Button>
              )}
            />
          )
          : (
            <Table>
              <thead>
                <tr>
                  <Th>{t('common.name')}</Th>
                  <Th>{t('services.billingType')}</Th>
                  {!branchId && <Th>{t('common.branch')}</Th>}
                  <Th align="right">{t('services.price')}</Th>
                  <Th>{t('services.validFrom')}</Th>
                  <Th align="right">{t('services.subscribers')}</Th>
                  <Th align="right">{t('common.actions')}</Th>
                </tr>
              </thead>
              <tbody>
                {list.data!.map((s) => {
                  const price = currentPrice(s);
                  return (
                    <Tr key={s.id} className={s.is_active ? '' : 'opacity-60'}>
                      <Td>
                        <span className="font-medium">{s.name}</span>
                        {!s.is_active && (
                          <span className="ml-1.5">
                            <Badge tone="neutral">{t('common.inactive')}</Badge>
                          </span>
                        )}
                        <span className="ml-1.5 text-[11px] text-[var(--text-faint)]">
                          {s.code}
                        </span>
                      </Td>
                      <Td>
                        <Badge tone={s.billing_type === 'daily' ? 'warn' : 'neutral'}>
                          {t(`services.type.${s.billing_type}`)}
                        </Badge>
                      </Td>
                      {/* deno-lint-ignore no-explicit-any */}
                      {!branchId && <Td>{(s as any).branches?.name}</Td>}
                      <Td align="right" mono>
                        {price
                          ? money(price.price, lang)
                          : <span className="text-[var(--danger)]">—</span>}
                      </Td>
                      <Td mono className="text-[var(--text-muted)]">
                        {price
                          ? (
                            <button
                              onClick={() => setHistoryFor({ id: s.id, name: s.name })}
                              className="hover:text-[var(--text)] hover:underline"
                              title={t('services.priceHistory')}
                            >
                              {date(price.from, lang)}
                            </button>
                          )
                          : '—'}
                      </Td>
                      <Td align="right" mono className="text-[var(--text-muted)]">
                        {subscribers.data?.get(s.id) ?? 0}
                      </Td>
                      <Td align="right">
                        {canEdit && (
                          <div className="flex justify-end gap-1.5">
                            <Button
                              size="sm" variant="ghost"
                              onClick={() => setPriceFor({
                                id: s.id, name: s.name,
                                current: price?.price ?? null,
                              })}
                            >
                              {t('services.price')}
                            </Button>
                            <Button size="sm" onClick={() => setEditing(s)}>
                              {t('common.edit')}
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

      <div className="mt-3">
        <Notice tone="neutral">{t('services.priceChangeNote')}</Notice>
      </div>

      {/* --- Xizmat qo'shish va tahrirlash ---------------------- */}
      {(adding || editing) && (
        <ServiceModal
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

      {/* --- Narx tarixi (TZ 4.4.5) ---------------------------- */}
      {historyFor && (
        <PriceHistoryModal
          service={historyFor}
          onClose={() => setHistoryFor(null)}
        />
      )}

      {/* --- Narx o'zgartirish (TZ 4.4.5) ----------------------- */}
      <PriceModal
        target={priceFor}
        onClose={() => setPriceFor(null)}
        onSubmit={(price, from) =>
          setPrice.mutate({ service_id: priceFor!.id, price, from })}
        busy={setPrice.isPending}
        error={setPrice.error ? (setPrice.error as Error).message : null}
      />
    </>
  );
}

// ---------------------------------------------------------------------

function ServiceModal({
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
  const [name, setName] = useState(existing?.name ?? '');
  const [code, setCode] = useState(existing?.code ?? '');
  const [type, setType] = useState<BillingType>(
    existing?.billing_type ?? 'monthly_fixed');
  const [branch, setBranch] = useState(existing?.branch_id ?? defaultBranch);
  const [price, setPrice] = useState('');
  const [isActive, setIsActive] = useState<boolean>(existing?.is_active ?? true);

  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit({
      id: existing?.id,
      name, code: code || name.toLowerCase().replace(/\s+/g, '_'),
      billing_type: type, branch_id: branch || defaultBranch, price,
      is_active: isActive,
    });
  }

  return (
    <Modal
      open title={existing ? t('services.edit') : t('services.add')} onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" form="service-form" type="submit"
                  disabled={busy || !name}>
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <form id="service-form" onSubmit={submit} className="space-y-3">
        <Field label={t('common.name')} required>
          <Input value={name} onChange={(e) => setName(e.target.value)}
                 autoFocus required />
        </Field>

        <Field label={t('services.code')}
               hint="Filiallar bo'yicha jamlash uchun. Bo'sh qoldirsangiz nomdan olinadi.">
          <Input value={code} onChange={(e) => setCode(e.target.value)}
                 placeholder="meals, transport..." />
        </Field>

        <Field label={t('services.billingType')}
               hint={t(`services.type.${type}.hint`)} required>
          <Select value={type} onChange={(e) => setType(e.target.value as BillingType)}>
            <option value="monthly_fixed">{t('services.type.monthly_fixed')}</option>
            <option value="daily">{t('services.type.daily')}</option>
            <option value="one_time">{t('services.type.one_time')}</option>
          </Select>
        </Field>

        {!existing && (
          <Field label={t('services.price')} required>
            <MoneyInput value={price} onChange={(e) => setPrice(e.target.value)}
                        required />
          </Field>
        )}

        {branches.length > 1 && !existing && (
          <Field label={t('common.branch')} required>
            <Select value={branch} onChange={(e) => setBranch(e.target.value)}>
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
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4"
              />
              {t('common.active')}
            </label>
            {!isActive && (
              <Notice tone="warn">{t('services.deactivateHint')}</Notice>
            )}
            <Notice tone="neutral">{t('services.priceIsSeparate')}</Notice>
          </>
        )}

        {error && <Notice tone="danger">{error}</Notice>}
      </form>
    </Modal>
  );
}

function PriceModal({
  target, onClose, onSubmit, busy, error,
}: {
  target: { id: string; name: string; current: number | null } | null;
  onClose: () => void;
  onSubmit: (price: number, from: string) => void;
  busy: boolean;
  error: string | null;
}) {
  const t = useT();
  const [price, setPrice] = useState('');
  const [from, setFrom] = useState(isoDate());

  return (
    <Modal
      open={!!target}
      title={`${t('services.price')} — ${target?.name ?? ''}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" form="set-price" type="submit"
                  disabled={busy || !price}>
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <form
        id="set-price"
        onSubmit={(e) => { e.preventDefault(); onSubmit(Number(price), from); }}
        className="space-y-3"
      >
        <Field label={t('services.price')} required>
          <MoneyInput value={price} onChange={(e) => setPrice(e.target.value)}
                      autoFocus required />
        </Field>
        <Field label={t('services.validFrom')} required
               hint="Shu sanadan oldingi davrlar o'zgarmaydi.">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                 required />
        </Field>
        <Notice tone="neutral">{t('services.priceChangeNote')}</Notice>
        {error && <Notice tone="danger">{error}</Notice>}
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------
//  NARX TARIXI (TZ 4.4.5)
//
//  "Narx o'zgarganda eski narx tarixda saqlanadi va o'tgan davrlarga
//  ta'sir qilmaydi." Shu tarixni ko'rish kerak: o'tgan oy hisoblanmasi
//  nega boshqacha chiqqani shu yerdan ko'rinadi.
// ---------------------------------------------------------------------

function PriceHistoryModal({
  service, onClose,
}: {
  service: { id: string; name: string };
  onClose: () => void;
}) {
  const t = useT();
  const { lang } = useI18n();

  const q = useQuery({
    queryKey: ['price-history', service.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('service_prices')
        .select('id, price, valid_from, valid_to, created_at')
        .eq('service_id', service.id)
        .order('valid_from', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const today = isoDate();

  return (
    <Modal
      open
      title={`${t('services.priceHistory')} — ${service.name}`}
      onClose={onClose}
      footer={<Button onClick={onClose}>{t('common.close')}</Button>}
    >
      {q.isLoading
        ? <Loading />
        : (q.data?.length ?? 0) === 0
        ? <EmptyState />
        : (
          <Table>
            <thead>
              <tr>
                <Th>{t('services.validFrom')}</Th>
                <Th>{t('services.validTo')}</Th>
                <Th align="right">{t('services.price')}</Th>
              </tr>
            </thead>
            <tbody>
              {q.data!.map((r) => {
                const active = r.valid_from <= today
                  && (!r.valid_to || r.valid_to >= today);
                return (
                  <Tr key={r.id} className={active ? '' : 'opacity-60'}>
                    <Td mono>{date(r.valid_from, lang)}</Td>
                    <Td mono className="text-[var(--text-muted)]">
                      {r.valid_to
                        ? date(r.valid_to, lang)
                        : <Badge tone="ok">{t('common.active')}</Badge>}
                    </Td>
                    <Td align="right" mono>{money(r.price, lang)}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
    </Modal>
  );
}
