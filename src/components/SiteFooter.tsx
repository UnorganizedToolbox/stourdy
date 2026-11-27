import { CONTACT_EMAIL, OPERATOR_NAME } from '@/lib/siteConfig';

export default function SiteFooter({ showPolicyLinks = false }: { showPolicyLinks?: boolean }) {
  return (
    <footer className="mt-auto pt-16 pb-8 text-center text-xs text-slate-500 dark:text-slate-400">
      {showPolicyLinks && (
        <div className="flex justify-center items-center gap-6 mb-3 font-medium">
          <a href="/terms" className="hover:text-brand-500 transition-colors">利用規約</a>
          <a href="/privacy" className="hover:text-brand-500 transition-colors">プライバシーポリシー</a>
        </div>
      )}
      {CONTACT_EMAIL && (
        <p className="mb-2">お問い合わせ: <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-slate-700 dark:hover:text-slate-300">{CONTACT_EMAIL}</a></p>
      )}
      <p>&copy; 2026 {OPERATOR_NAME}. Released under the MIT License.</p>
    </footer>
  );
}
