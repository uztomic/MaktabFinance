// =====================================================================
//  Kassa kvitansiyasi (TZ 4.7.1.2).
//
//  "Tizim RAQAMLANGAN kvitansiya shakllantiradi."
//
//  Raqam bazada `app.next_counter` orqali atomar olinadi va filial
//  bo'yicha uzluksiz ketma-ketlikda beriladi (TZ 4.7.1.5) — bu yerda
//  faqat ko'rsatiladi va chop etiladi.
//
//  Chop etishda faqat kvitansiyaning o'zi chiqadi: `no-print` sinfi
//  qolgan hamma narsani yashiradi (index.css dagi @media print).
// =====================================================================

import { useI18n, useT } from '@/i18n';
import { date, money } from '@/lib/format';
import { Button, Modal, Notice } from '@/ui';

export interface ReceiptData {
  receipt_code: string;
  amount: number | string;
  paid_on: string;
  student_name: string;
  student_class?: string | null;
  payment_code?: string | null;
  balance?: number | string | null;
  cashier?: string | null;
  method_name?: string | null;
  school_name: string;
  branch_name?: string | null;
}

export function ReceiptModal({
  data, onClose,
}: {
  data: ReceiptData | null;
  onClose: () => void;
}) {
  const t = useT();
  const { lang } = useI18n();

  if (!data) return null;

  const balance = Number(data.balance ?? 0);

  return (
    <Modal
      open={!!data}
      title={t('receipt.title')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.close')}</Button>
          <Button variant="primary" onClick={() => window.print()}>
            🖨 {t('receipt.print')}
          </Button>
        </>
      }
    >
      {/* Chop etiladigan qism */}
      <div id="receipt" className="mx-auto max-w-sm">
        <div className="rounded-lg border-2 border-dashed p-4">
          <div className="text-center">
            <div className="text-sm font-semibold">{data.school_name}</div>
            {data.branch_name && (
              <div className="text-[12px] text-[var(--text-muted)]">
                {data.branch_name}
              </div>
            )}
            <div className="mt-2 text-[11px] uppercase tracking-wide
              text-[var(--text-muted)]">
              {t('receipt.title')}
            </div>
            <div className="num mt-0.5 text-lg font-bold tracking-wider">
              {data.receipt_code}
            </div>
          </div>

          <div className="my-3 border-t border-dashed" />

          <dl className="space-y-1.5 text-[13px]">
            <Row label={t('common.date')} value={date(data.paid_on, lang)} />
            <Row label={t('receipt.from')} value={data.student_name} />
            {data.student_class && (
              <Row label={t('students.class')} value={data.student_class} />
            )}
            {data.payment_code && (
              <Row label={t('students.paymentCode')} value={data.payment_code} mono />
            )}
            <Row label={t('receipt.for')} value={t('receipt.tuition')} />
            {data.method_name && (
              <Row label={t('payMethod.label')} value={data.method_name} />
            )}
          </dl>

          <div className="my-3 border-t border-dashed" />

          <div className="flex items-baseline justify-between">
            <span className="text-[13px] font-medium">{t('receipt.received')}</span>
            <span className="num text-xl font-bold">
              {money(data.amount, lang)}
            </span>
          </div>

          {data.balance !== null && data.balance !== undefined && (
            <div className="mt-1.5 flex items-baseline justify-between text-[12px]">
              <span className="text-[var(--text-muted)]">
                {t('receipt.balanceAfter')}
              </span>
              <span className={`num font-medium ${
                balance > 0 ? 'text-[var(--danger)]'
                  : balance < 0 ? 'text-[var(--ok)]' : ''}`}>
                {balance < 0
                  ? `${t('students.advance')} ${money(-balance, lang)}`
                  : money(balance, lang)}
              </span>
            </div>
          )}

          <div className="my-3 border-t border-dashed" />

          <div className="flex items-end justify-between gap-4 text-[11px]
            text-[var(--text-muted)]">
            <div className="flex-1">
              <div>{t('receipt.cashier')}</div>
              <div className="mt-0.5 text-[var(--text)]">{data.cashier ?? '—'}</div>
            </div>
            <div className="flex-1 text-right">
              <div>{t('receipt.signature')}</div>
              <div className="mt-3 border-b border-dotted" />
            </div>
          </div>

          <div className="mt-3 text-center text-[11px] text-[var(--text-muted)]">
            {t('receipt.thanks')}
          </div>
        </div>
      </div>

      <div className="no-print mt-3">
        <Notice tone="neutral">
          Kvitansiya raqami Telegram orqali ota-onaga ham yuborildi.
        </Notice>
      </div>
    </Modal>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-[var(--text-muted)]">{label}</dt>
      <dd className={mono ? 'num font-medium' : 'font-medium'}>{value}</dd>
    </div>
  );
}
