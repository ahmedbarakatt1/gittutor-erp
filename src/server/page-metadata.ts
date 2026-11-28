import type { Metadata } from 'next';
import { getSiteLanguage } from './site-language';

const titles: Record<string, string> = {
  'Actual records': 'أرشيف السجلات',
  Administration: 'الإدارة',
  'Apply to teach': 'التقديم للتدريس',
  'Authorize original funds': 'اعتماد استخدام المبلغ الأصلي',
  Campaigns: 'الحملات',
  'Catalog and policies': 'دليل الحصص والسياسات',
  'Confirm payment use': 'تأكيد تخصيص الدفعة',
  'Create an account': 'إنشاء حساب',
  'Customer service': 'خدمة العملاء',
  Finance: 'المالية',
  'Financial exceptions': 'حالات مالية تحتاج إلى مراجعة',
  'Incoming transfer': 'تفاصيل التحويل الوارد',
  'Incoming transfers': 'التحويلات الواردة',
  Integrations: 'ربط الخدمات',
  'Offer and terms': 'تفاصيل الحصة وشروطها',
  'Package details': 'تفاصيل الباقة',
  'Package operations': 'إدارة الباقات',
  'Payment comparison': 'مقارنة الدفعات',
  'Payment instructions': 'تعليمات الدفع',
  'Payment reviews': 'مراجعة المدفوعات',
  Payments: 'المدفوعات',
  'Quizzes and grades': 'الاختبارات والدرجات',
  'Receipt review': 'مراجعة إيصال الدفع',
  'Receiving accounts and funds': 'حسابات الاستلام والأموال الواردة',
  Refund: 'تفاصيل الاسترداد',
  'Refund review': 'مراجعة طلب الاسترداد',
  Refunds: 'طلبات الاسترداد',
  'Request a session': 'طلب حصة',
  'Reset your password': 'إعادة تعيين كلمة المرور',
  'Session operations': 'إدارة الحصص',
  'Session pricing': 'أسعار الحصص',
  'Session quizzes': 'اختبارات الحصص',
  'Session requests': 'طلبات الحصص',
  'Set your password': 'اختيار كلمة المرور',
  'Sign in': 'تسجيل الدخول',
  'Staff and applications': 'الفريق وطلبات التدريس',
  'Statement review': 'مراجعة كشف الحساب',
  'Student progression': 'تقدّم الطلاب',
  'Study files': 'ملفات الدراسة',
  Subjects: 'المواد الدراسية',
  Support: 'الدعم',
  'Teaching operations': 'متابعة التدريس',
  'Teaching schedule': 'جدول التدريس',
  'Team workload': 'توزيع العمل على الفريق',
  'Tutor pay': 'مستحقات المدرّسين',
  'Tutor profile': 'الملف التعريفي للمدرّس',
  'Tutor workspace': 'مساحة المدرّس',
  'Verify your email': 'تأكيد البريد الإلكتروني',
  'Your learning': 'مساحتك الدراسية',
  'Your packages': 'باقاتك',
  'Your reservation': 'تفاصيل حجزك',
  'Your sessions': 'حصصك',
  'Your transfer': 'تفاصيل تحويلك',
};

export function pageMetadata(english: Metadata) {
  return async (): Promise<Metadata> => {
    if (await getSiteLanguage() === 'en' || typeof english.title !== 'string') return english;
    const key = english.title.split(' | Git Tutor')[0];
    const translated = titles[key];
    return {
      ...english,
      title: translated ? translated + ' | Git Tutor' : english.title,
      ...(key === 'Subjects' ? { description: 'اختر موضوعًا للدراسة أو اطلب شرحًا لجزء من مقررك.' } : {}),
      ...(key === 'Session pricing' ? { description: 'تعرّف على أسعار الحصص الفردية والجماعية لكل طالب.' } : {}),
    };
  };
}
