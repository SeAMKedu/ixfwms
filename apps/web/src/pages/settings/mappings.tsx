import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDeleteImportMapping, useImportMappings } from '../../api/queries';
import { useSession } from '../../auth/session';
import { Button, Card, Empty, ErrorBox, Loading, PageHeader } from '../../components/ui';

export function MappingsSection() {
  const { t } = useTranslation();
  const { can } = useSession();
  const mappings = useImportMappings();
  const remove = useDeleteImportMapping();
  return (
    <>
      <PageHeader title={t('settings.mappings')} />
      <Card>
        <p className="max-w-prose text-[13px] text-muted">{t('settings.mappingsIntro')}</p>
        {mappings.isPending ? (
          <Loading />
        ) : !mappings.data?.length ? (
          <Empty>{t('settings.noMappings')}</Empty>
        ) : (
          <ul className="flex flex-col">
            {mappings.data.map((m) => (
              <li
                key={m.name}
                className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2 first:border-t-0"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium">{m.name}</span>
                  <span className="truncate text-[12px] text-muted">
                    {Object.entries(m.mapping.columns)
                      .map(([field, column]) => `${column} → ${t(`import.fields.${field}`)}`)
                      .join(' · ')}
                  </span>
                </span>
                {can('inventory') && (
                  <Button small variant="ghost" onClick={() => remove.mutate(m.name)}>
                    <Trash2 className="size-4" aria-hidden />
                    {t('common.remove')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        <ErrorBox error={remove.error ?? mappings.error} />
      </Card>
    </>
  );
}
