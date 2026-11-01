// =====================================================================
//  O'quvchidan to'lov qabul qilish — o'quvchi kartochkasi va "Tez to'lov"
//  oynasi uchun YAGONA yo'l. Hammasi server tomonida (TZ 5.4.6):
//  chegirma, aralash to'lov va oddiy to'lov alohida RPC lar.
// =====================================================================

import { supabase } from '@/lib/supabase';

export interface StudentPaymentInput {
  amount: number; paid_on: string; note: string; method_id: string;
  parts?: Array<{ method_id: string; amount: number }>;
  discount?: { amount: number; reason: string };
}

export interface StudentPaymentResult {
  receipt_code: string; balance: number; method_name: string;
}

export async function submitStudentPayment(
  studentId: string,
  v: StudentPaymentInput,
): Promise<StudentPaymentResult> {
  const id = studentId;

      //  CHEGIRMA AVVAL. Aks holda kvitansiyada ko'rsatiladigan
      //  balans eski hisobdan chiqadi va ota-onaga noto'g'ri qarz
      //  yuboriladi.
      if (v.discount) {
        const { error: dErr } = await supabase.rpc('add_invoice_discount', {
          p_student_id: id!,
          p_period: v.paid_on.slice(0, 8) + '01',
          p_amount: v.discount.amount,
          p_reason: v.discount.reason,
        });
        if (dErr) throw dErr;
      }

      if (v.parts?.length) {
        const { data, error } = await supabase.rpc('register_split_payment', {
          p_student_id: id!,
          p_parts: v.parts,
          p_paid_on: v.paid_on,
          p_note: v.note || undefined,
        });
        if (error) throw error;
        const r = data as unknown as {
          receipt_code: string; balance: number;
          parts: Array<{ method_name: string; amount: number }>;
        };
        return {
          receipt_code: r.receipt_code,
          balance: r.balance,
          //  Kvitansiyada usul o'rniga qismlar ro'yxati chiqadi.
          method_name: r.parts
            .map((x) => `${x.method_name} ${Number(x.amount).toLocaleString()}`)
            .join(' + '),
        };
      }

      const { data, error } = await supabase.rpc('register_cash_payment', {
        p_student_id: id!,
        p_amount: v.amount,
        p_paid_on: v.paid_on,
        p_note: v.note || undefined,
        p_method_id: v.method_id || undefined,
      });
      if (error) throw error;
      return data as {
        receipt_code: string; balance: number; method_name: string;
      };
    }
