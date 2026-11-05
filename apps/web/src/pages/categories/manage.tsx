import type { CategoryInfo } from '@ixfwms/domain';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useDeleteCategory, useMoveCategory } from '../../api/categories';
import { Button, Card, ErrorBox, Field, TextInput } from '../../components/ui';

/**
 * Rename or move a category (a new full path: "Pneumatics/Vacuum" moves it under Pneumatics),
 * or delete it, sending its items to another category.
 */
export function ManageCategory({
  category,
  all,
  onMoved,
  onDeleted,
}: {
  category: CategoryInfo;
  all: CategoryInfo[];
  onMoved: (path: string) => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const [to, setTo] = useState(category.path);
  const [moveTo, setMoveTo] = useState('');
  const move = useMoveCategory();
  const remove = useDeleteCategory();
  const hasChildren = all.some((c) => c.path.startsWith(`${category.path}/`));
  const others = all.filter((c) => c.path !== category.path);

  const saveMove = async (e: FormEvent) => {
    e.preventDefault();
    const { path } = await move.mutateAsync({ path: category.path, to });
    onMoved(path);
  };
  const doDelete = async (e: FormEvent) => {
    e.preventDefault();
    if (!window.confirm(t('categories.deleteConfirm', { path: category.path }))) return;
    await remove.mutateAsync({ path: category.path, moveTo: moveTo || null });
    onDeleted();
  };

  return (
    <Card title={t('categories.manage')}>
      <form onSubmit={(e) => void saveMove(e)} className="flex flex-col gap-2">
        <Field label={t('categories.renameOrMove')} hint={t('categories.renameHint')}>
          {(id) => (
            <TextInput id={id} required value={to} onChange={(e) => setTo(e.target.value)} />
          )}
        </Field>
        <ErrorBox error={move.error} />
        <Button
          type="submit"
          busy={move.isPending}
          disabled={to.trim() === category.path}
          className="self-start"
        >
          {t('categories.saveName')}
        </Button>
      </form>
      <form
        onSubmit={(e) => void doDelete(e)}
        className="flex flex-col gap-2 border-t border-line pt-3"
      >
        {hasChildren ? (
          <p className="text-sm text-muted">{t('categories.deleteHasChildren')}</p>
        ) : (
          <>
            {category.ownParts > 0 && (
              <Field label={t('categories.moveItemsTo', { count: category.ownParts })}>
                {(id) => (
                  <>
                    <TextInput
                      id={id}
                      required
                      list="other-categories"
                      value={moveTo}
                      onChange={(e) => setMoveTo(e.target.value)}
                    />
                    <datalist id="other-categories">
                      {others.map((c) => (
                        <option key={c.path} value={c.path} />
                      ))}
                    </datalist>
                  </>
                )}
              </Field>
            )}
            <ErrorBox error={remove.error} />
            <Button type="submit" busy={remove.isPending} className="self-start">
              {t('categories.delete')}
            </Button>
          </>
        )}
      </form>
    </Card>
  );
}
