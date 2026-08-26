// =====================================================================
//  Marshrutlar.
//
//  Yo'l nomlari o'zbekcha — foydalanuvchi manzil satrida nima
//  ochilganini tushunsin.
//
//  Har bir sahifa o'z ichida huquqni ham tekshiradi (menyu yashirilgan
//  bo'lsa ham manzilni qo'lda yozib kirish mumkin). Haqiqiy himoya
//  esa bazadagi RLS da.
// =====================================================================

import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { useT } from '@/i18n';
import LoginPage from '@/auth/LoginPage';
import ResetPasswordPage from '@/auth/ResetPasswordPage';
import AppShell from '@/layout/AppShell';
import SuspendedShell from '@/layout/SuspendedShell';
import { Button, Loading, Notice } from '@/ui';

const Dashboard   = lazy(() => import('@/features/Dashboard'));
const Students    = lazy(() => import('@/features/Students'));
const StudentCard = lazy(() => import('@/features/StudentCard'));
const Classes     = lazy(() => import('@/features/Classes'));
const ClassCard   = lazy(() => import('@/features/ClassCard'));
const Services    = lazy(() => import('@/features/Services'));
const Invoices    = lazy(() => import('@/features/Invoices'));
const Payments    = lazy(() => import('@/features/Payments'));
const Debts       = lazy(() => import('@/features/Debts'));
const Expenses    = lazy(() => import('@/features/Expenses'));
const Reports     = lazy(() => import('@/features/Reports'));
const Leads       = lazy(() => import('@/features/Leads'));
const Absences    = lazy(() => import('@/features/Absences'));
const Teachers    = lazy(() => import('@/features/Teachers'));
const TeacherCard = lazy(() => import('@/features/TeacherCard'));
const Messages    = lazy(() => import('@/features/Messages'));
const Payroll     = lazy(() => import('@/features/Payroll'));
const PayrollCard = lazy(() => import('@/features/PayrollCard'));
const Branches    = lazy(() => import('@/features/Branches'));
const Users       = lazy(() => import('@/features/Users'));
const Audit       = lazy(() => import('@/features/Audit'));
const Settings    = lazy(() => import('@/features/Settings'));
const MyAttendance = lazy(() => import('@/features/teacher/MyAttendance'));
const MyLoad      = lazy(() => import('@/features/teacher/MyLoad'));
const MyPayroll   = lazy(() => import('@/features/teacher/MyPayroll'));
const Subscription = lazy(() => import('@/features/Subscription'));
const SupportChat  = lazy(() => import('@/features/SupportChat'));

function NoProfile() {
  const t = useT();
  const { signOut } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md text-center">
        <Notice tone="danger">{t('auth.noProfile')}</Notice>
        <Button className="mt-4" onClick={signOut}>{t('auth.logout')}</Button>
      </div>
    </div>
  );
}

export default function App() {
  const { session, profile, loading, error } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loading />
      </div>
    );
  }

  // MUHIM: parol tiklash sahifasi profil tekshiruvidan OLDIN.
  // Tiklash havolasi vaqtinchalik sessiya ochadi — agar shu yerda
  // to'xtatmasak, foydalanuvchi to'g'ri panelga tushib ketadi va
  // yangi parolni qo'yolmay qoladi.
  if (globalThis.location?.pathname.endsWith('/parol-tiklash')) {
    return (
      <Routes>
        <Route path="/parol-tiklash" element={<ResetPasswordPage />} />
      </Routes>
    );
  }

  if (!session) return <LoginPage />;
  if (error === 'noProfile' || !profile) return <NoProfile />;

  // BLOKLANGAN MAKTAB — oddiy panel ko'rsatilmaydi.
  //
  // To'lov 45 kundan ortiq kechikkanda maktab `restricted` holatiga
  // o'tadi va TZ 2.4 bo'yicha tizimga KIRA OLMAYDI.
  //
  // NEGA SHU YERDA, RLS DA EMAS (TZ 2.4 "Kirish darajasi"): bazani
  // yopib qo'ysak direktor to'lov ekranini ham ko'ra olmaydi va
  // tizim boshi berk ko'chaga kiradi — mijoz to'lay olmaydi.
  // Shuning uchun baza o'qishga ochiq qoladi (yozish esa
  // `app.school_is_writable()` bilan to'silgan), kirishni esa
  // shu qator to'sadi.
  //
  // Ma'lumot O'CHIRILMAYDI — to'lov tasdiqlangach hammasi qaytadi.
  if (profile.school_status === 'restricted') return <SuspendedShell />;

  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Dashboard />} />
          <Route path="oquvchilar" element={<Students />} />
          <Route path="oquvchilar/:id" element={<StudentCard />} />
          <Route path="sinflar" element={<Classes />} />
          <Route path="sinflar/:id" element={<ClassCard />} />
          <Route path="xizmatlar" element={<Services />} />
          <Route path="yoqlik" element={<Absences />} />
          <Route path="murojaatlar" element={<Leads />} />
          <Route path="hisoblanma" element={<Invoices />} />
          <Route path="tolovlar" element={<Payments />} />
          <Route path="qarzdorlik" element={<Debts />} />
          <Route path="xarajatlar" element={<Expenses />} />
          <Route path="hisobotlar" element={<Reports />} />
          <Route path="oqituvchilar" element={<Teachers />} />
          <Route path="oqituvchilar/:id" element={<TeacherCard />} />
          <Route path="xabarlar" element={<Messages />} />
          <Route path="oylik" element={<Payroll />} />
          <Route path="oylik/:id" element={<PayrollCard />} />
          <Route path="filiallar" element={<Branches />} />
          <Route path="foydalanuvchilar" element={<Users />} />
          <Route path="jurnal" element={<Audit />} />
          <Route path="sozlamalar" element={<Settings />} />
          <Route path="obuna" element={<Subscription />} />
          <Route path="yordam" element={<SupportChat />} />
          <Route path="davomat" element={<MyAttendance />} />
          <Route path="yuklamam" element={<MyLoad />} />
          <Route path="oyligim" element={<MyPayroll />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
