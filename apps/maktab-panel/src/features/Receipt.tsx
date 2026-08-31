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

import { useState } from 'react';
import { useI18n, useT } from '@/i18n';
import { date, money } from '@/lib/format';
import {
  bluetoothSupported, buildAiyinJob, buildEscPosJob, buildTextJob,
  canvasToBitmap, connectPrinter, loadSettings, type PrintMode,
  type PrinterSettings, saveSettings,
} from '@/lib/printer';
import { receiptLines, renderReceipt } from '@/lib/receiptCanvas';
import { Button, Modal, Notice, Select } from '@/ui';

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

  const [cfg, setCfg] = useState<PrinterSettings>(loadSettings);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [showCfg, setShowCfg] = useState(false);

  const canBt = bluetoothSupported();

  /**
   *  Bluetooth orqali chop etish.
   *
   *  Har chop etishda qurilma qaytadan tanlanadi. Web Bluetooth
   *  ulanishni sahifa yangilanguncha eslab qolmaydi — bu brauzer
   *  cheklovi, atrofidan aylanib o'tib bo'lmaydi.
   */
  async function printBt() {
    if (!data) return;
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const labels = {
        title: t('receipt.title'),
        date: t('common.date'),
        from: t('receipt.from'),
        klass: t('students.class'),
        code: t('students.paymentCode'),
        method: t('payMethod.label'),
        received: t('receipt.received'),
        balanceAfter: t('receipt.balanceAfter'),
        advance: t('students.advance'),
        cashier: t('receipt.cashier'),
        thanks: t('receipt.thanks'),
      };

      const bytes = cfg.mode === 'text'
        ? buildTextJob(receiptLines(data, labels, lang,
            cfg.width >= 576 ? 48 : 32))
        : (() => {
            const canvas = renderReceipt(data, labels, lang, cfg.width, cfg.scale);
            const bmp = canvasToBitmap(canvas);
            return cfg.mode === 'aiyin'
              ? buildAiyinJob(bmp)
              : buildEscPosJob(bmp);
          })();

      const printer = await connectPrinter();
      try {
        await printer.write(bytes);
        setOk(printer.name);
      } finally {
        printer.disconnect();
      }
    } catch (e) {
      const m = (e as Error).message ?? String(e);
      //  Foydalanuvchi ro'yxatni yopgan bo'lsa — xato emas.
      setErr(/cancel|User cancelled/i.test(m) ? null : m);
    } finally {
      setBusy(false);
    }
  }

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
          <Button onClick={() => window.print()}>
            🖨 {t('receipt.print')}
          </Button>
          {canBt && (
            <Button variant="primary" onClick={printBt} disabled={busy}>
              {busy ? t('receipt.printing') : `📶 ${t('receipt.printBt')}`}
            </Button>
          )}
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

      <div className="no-print mt-3 space-y-2">
        {ok && <Notice tone="ok">{t('receipt.printed', { name: ok })}</Notice>}
        {err && <Notice tone="danger">{err}</Notice>}

        <Notice tone="neutral">{t('receipt.sentToParent')}</Notice>

        {canBt && (
          <div>
            <button
              type="button"
              onClick={() => setShowCfg((v) => !v)}
              className="text-[12px] text-[var(--text-muted)] underline"
            >
              {t('receipt.printerSettings')}
            </button>

            {showCfg && (
              <div className="mt-2 grid gap-2 rounded-md border
                bg-[var(--bg-subtle)] p-3 sm:grid-cols-3">
                <label className="text-[12px]">
                  <span className="block text-[var(--text-muted)]">
                    {t('receipt.mode')}
                  </span>
                  <Select
                    value={cfg.mode}
                    onChange={(e) => {
                      const next = {
                        ...cfg, mode: e.target.value as PrintMode,
                      };
                      setCfg(next);
                      saveSettings(next);
                    }}
                  >
                    <option value="aiyin">AiYin / B21</option>
                    <option value="image">{t('receipt.modeImage')}</option>
                    <option value="text">{t('receipt.modeText')}</option>
                  </Select>
                </label>

                <label className="text-[12px]">
                  <span className="block text-[var(--text-muted)]">
                    {t('receipt.paperWidth')}
                  </span>
                  <Select
                    value={String(cfg.width)}
                    onChange={(e) => {
                      const next = { ...cfg, width: Number(e.target.value) };
                      setCfg(next);
                      saveSettings(next);
                    }}
                  >
                    <option value="384">58 mm</option>
                    <option value="576">80 mm</option>
                  </Select>
                </label>

                <label className="text-[12px]">
                  <span className="block text-[var(--text-muted)]">
                    {t('receipt.fontSize')}
                  </span>
                  <Select
                    value={cfg.scale}
                    onChange={(e) => {
                      const next = {
                        ...cfg, scale: e.target.value as PrinterSettings['scale'],
                      };
                      setCfg(next);
                      saveSettings(next);
                    }}
                  >
                    <option value="sm">{t('receipt.sizeSm')}</option>
                    <option value="md">{t('receipt.sizeMd')}</option>
                    <option value="lg">{t('receipt.sizeLg')}</option>
                  </Select>
                </label>

                <p className="text-[11px] text-[var(--text-muted)] sm:col-span-3">
                  {t('receipt.modeHint')}
                </p>
              </div>
            )}
          </div>
        )}
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
