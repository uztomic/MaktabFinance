// =====================================================================
//  Qarz eslatmasi — ota-onaga bir bosishda SMS / Telegram / qo'ng'iroq.
//
//  Telegram bot avtomatik eslatma yuboradi, lekin faqat botga ulangan
//  ota-onaga. Ulanmaganlarga (odatda ko'pchilik) buxgalter qo'lda
//  qo'ng'iroq qilardi. Endi tayyor matn kassirning o'z telefonidan
//  SMS bo'lib ketadi — SMS provayderi va qo'shimcha xarajat yo'q,
//  ota-ona raqamni taniydi.
// =====================================================================

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n, useT } from '@/i18n';
import { date, money } from '@/lib/format';
import { Button, Modal, Notice, Spinner } from '@/ui';

export interface DebtTarget {
  student_id: string;
  full_name: string;
  class_name?: string | null;
  payment_code?: string | null;
  balance: number;
  oldest_due?: string | null;
}

function cleanPhone(p: string): string {
  const d = p.replace(/[^\d+]/g, '');
  return d.startsWith('+') ? d : d.length === 9 ? `+998${d}` : d.length === 12 ? `+${d}` : d;
}

export function DebtReminderModal({ target, onClose }: { target: DebtTarget; onClose: () => void }) {
  const t = useT();
  const { lang } = useI18n();
  const { profile } = useAuth();
  const [text, setText] = useState('');
  const [copied, setCopied] = useState(false);

  const parents = useQuery({
    queryKey: ['student-parents-phones', target.student_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('student_parents')
        .select('parents(full_name, phone, telegram_id)')
        .eq('student_id', target.student_id);
      if (error) throw error;
      // deno-lint-ignore no-explicit-any
      return (data ?? []).map((r: any) => r.parents).filter(Boolean) as
        Array<{ full_name: string; phone: string; telegram_id: number | null }>;
    },
  });

  useEffect(() => {
    setText(t('remind.template', {
      school: profile?.school_name ?? '',
      student: target.full_name,
      klass: target.class_name ? ` (${target.class_name})` : '',
      amount: money(target.balance, lang),
      since: target.oldest_due ? t('remind.since', { date: date(target.oldest_due, lang) }) : '',
      code: target.payment_code ?? '—',
    }));
  }, [target, profile?.school_name, lang, t]);

  const list = parents.data ?? [];

  return (
    <Modal open title={`${t('remind.title')} — ${target.full_name}`} onClose={onClose}>
      <div className="space-y-3">
        <textarea
          className="min-h-[150px] w-full rounded-md border bg-[var(--bg)] px-3 py-2 text-[13px]"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {parents.isLoading ? <Spinner /> : list.length === 0 ? (
          <Notice tone="warn">{t('remind.noParent')}</Notice>
        ) : (
          <ul className="space-y-2">
            {list.map((p) => {
              const tel = cleanPhone(p.phone);
              return (
                <li key={p.phone} className="rounded-lg border px-3 py-2.5">
                  <div className="mb-2 flex items-center justify-between gap-2 text-[13px]">
                    <span className="font-medium">{p.full_name}</span>
                    <span className="font-mono text-[var(--text-muted)]">{tel}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    <a className="flex min-h-10 items-center justify-center rounded-md bg-brand-700 text-[13px] font-medium text-white"
                       href={`sms:${tel}?body=${encodeURIComponent(text)}`}>SMS</a>
                    <a className="flex min-h-10 items-center justify-center rounded-md border text-[13px] font-medium"
                       href={`tel:${tel}`}>{t('remind.call')}</a>
                    <a className="flex min-h-10 items-center justify-center rounded-md border text-[13px] font-medium"
                       href={`https://t.me/share/url?url=${encodeURIComponent(' ')}&text=${encodeURIComponent(text)}`}
                       target="_blank" rel="noreferrer">Telegram</a>
                  </div>
                  {p.telegram_id && (
                    <div className="mt-1.5 text-[11.5px] text-[var(--ok)]">{t('remind.botLinked')}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <Button
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => {});
          }}
        >
          {copied ? t('remind.copied') : t('remind.copy')}
        </Button>
      </div>
    </Modal>
  );
}
