// =====================================================================
//  Ma'lumotnoma tanlagich — ro'yxatdan tanlash + yangisini qo'shish.
//
//  MUAMMO: manba, toifa kabi maydonlar erkin matn edi. "Instagram",
//  "instagram", "insta" — bir kanal uch xil yozilib, "qaysi kanal
//  ko'proq mijoz keltiryapti" degan savol javobsiz qolardi.
//
//  YECHIM: ro'yxatdan tanlanadi. Lekin ro'yxat YOPIQ emas — kerakli
//  qiymat yo'q bo'lsa foydalanuvchi shu yerning o'zida qo'shadi va u
//  butun maktab uchun saqlanadi. Dasturchi kerak emas.
//
//  Qiymat bazaga MATN bo'lib yoziladi (id emas): mavjud ustunlar
//  o'zgarmaydi va eski yozuvlar o'qilaveradi.
// =====================================================================

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useT } from '@/i18n';
import { Button, Field, Input, Select } from './index';
import { useToast } from './Feedback';

/** Ro'yxatlar. Yangisi uchun migratsiya kerak emas. */
export type LookupKind = 'lead_source' | 'teacher_category';

export function useLookups(kind: LookupKind) {
  return useQuery({
    queryKey: ['lookups', kind],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lookups')
        .select('id, name, sort_order')
        .eq('kind', kind)
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('sort_order')
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function CatalogSelect({
  kind, value, onChange, label, hint, required, disabled,
}: {
  kind: LookupKind;
  /** Saqlangan MATN qiymat (id emas). */
  value: string;
  onChange: (name: string) => void;
  label: string;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const { profile } = useAuth();

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  const list = useLookups(kind);
  const options = list.data ?? [];

  const add = useMutation({
    mutationFn: async (name: string) => {
      const clean = name.trim();
      if (!clean) throw new Error(t('catalog.emptyName'));

      // Ro'yxatda allaqachon bormi (katta-kichik harf farqisiz)?
      const existing = options.find(
        (o) => o.name.toLowerCase() === clean.toLowerCase());
      if (existing) return existing.name;

      const { data, error } = await supabase.from('lookups').insert({
        school_id: profile!.school_id,
        kind,
        name: clean,
        sort_order: 500,
      }).select('name').single();
      if (error) throw error;
      return data.name;
    },
    onSuccess: (name) => {
      qc.invalidateQueries({ queryKey: ['lookups', kind] });
      onChange(name);
      setAdding(false);
      setDraft('');
      toast.ok(t('catalog.added', { name }));
    },
    onError: (e) => toast.error((e as Error).message),
  });

  // Eski yozuvda ro'yxatda yo'q qiymat bo'lishi mumkin — uni
  // YO'QOTMAYMIZ, ro'yxatga vaqtincha qo'shib ko'rsatamiz.
  const orphan = value
    && !options.some((o) => o.name.toLowerCase() === value.toLowerCase());

  if (adding) {
    return (
      <Field label={label} hint={t('catalog.newHint')}>
        <div className="flex gap-1.5">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('catalog.newPlaceholder')}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); add.mutate(draft); }
              if (e.key === 'Escape') { e.preventDefault(); setAdding(false); }
            }}
          />
          <Button type="button" variant="primary" size="md"
                  disabled={add.isPending || !draft.trim()}
                  onClick={() => add.mutate(draft)}>
            {add.isPending ? '…' : t('common.add')}
          </Button>
          <Button type="button" size="md" onClick={() => setAdding(false)}>
            {t('common.cancel')}
          </Button>
        </div>
      </Field>
    );
  }

  return (
    <Field label={label} hint={hint} required={required}>
      <div className="flex gap-1.5">
        <Select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled || list.isLoading}
          required={required}
        >
          <option value="">{required ? '—' : t('catalog.notSet')}</option>
          {orphan && <option value={value}>{value}</option>}
          {options.map((o) => (
            <option key={o.id} value={o.name}>{o.name}</option>
          ))}
        </Select>
        {!disabled && (
          <Button
            type="button"
            size="md"
            title={t('catalog.add')}
            onClick={() => { setDraft(''); setAdding(true); }}
            className="shrink-0"
          >
            +
          </Button>
        )}
      </div>
    </Field>
  );
}
