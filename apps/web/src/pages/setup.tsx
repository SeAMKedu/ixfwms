import { CheckCircle2, Download, ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useInfo, useSetup } from '../api/queries';
import { Card, CodeLabel, Loading, PageHeader } from '../components/ui';

/** How to get the phone camera working (HTTPS + trusting the lab's certificate), and how to connect AI tools. */
export function SetupPage() {
  const { t } = useTranslation();
  const setup = useSetup();
  const info = useInfo();
  if (setup.isPending) return <Loading />;
  const s = setup.data;
  const steps = ['ios', 'android', 'mac', 'windows'] as const;
  return (
    <>
      <PageHeader title={t('setup.title')} />
      <Card>
        {s?.secure ? (
          <p className="flex items-center gap-2 text-ok">
            <CheckCircle2 className="size-5" aria-hidden />
            {t('setup.secure')}
          </p>
        ) : (
          <p className="flex items-center gap-2 text-warn">
            <ShieldAlert className="size-5" aria-hidden />
            {t('setup.insecure')}
          </p>
        )}
        <p className="text-sm text-muted">{t('setup.why')}</p>
      </Card>
      <Card title={t('setup.certTitle')}>
        {s?.certificate ? (
          <a
            href="/api/setup/root.crt"
            download
            className="inline-flex items-center gap-2 self-start rounded-lg bg-ink px-3.5 py-2 text-sm font-semibold text-bg"
          >
            <Download className="size-4" aria-hidden />
            {t('setup.download')}
          </a>
        ) : (
          <p className="text-sm text-muted">{t('setup.noCert')}</p>
        )}
        <dl className="flex flex-col gap-2 text-sm">
          {steps.map((k) => (
            <div key={k}>
              <dt className="font-medium">{t(`setup.steps.${k}.title`)}</dt>
              <dd className="text-muted">{t(`setup.steps.${k}.text`)}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Card title={t('setup.aiTitle')}>
        <p className="text-sm">{t('setup.aiText')}</p>
        <code className="break-all rounded bg-surface-2 px-2 py-1 font-mono text-[12px]">
          {`claude mcp add --transport http ixfwms ${info.data?.mcpUrl ?? ''} --header "Authorization: Bearer ixf_…"`}
        </code>
        <p className="text-[13px] text-muted">
          {t('setup.baseUrl')} <CodeLabel code={s?.baseUrl ?? ''} />
        </p>
      </Card>
    </>
  );
}
