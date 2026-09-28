import {
  BlockStack,
  IndexTable,
  IndexTableSelectionType,
  Modal,
  Text,
  TextField,
} from '@shopify/polaris';
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../lib/api';
import { type ClassifiedError, classifyError } from '../lib/errors';

export interface CollectionChoice {
  shopifyCollectionId: number;
  title: string;
}

const PAGE_SIZE = 20;

/**
 * Multi-select picker over the store's own collections, for the Manage page's
 * "Add collections" and "Exclude collections". The whole list is fetched once
 * when the modal opens and searched in the browser, so typing costs no Shopify
 * calls (the search endpoint reads the live list from Shopify each time).
 * Ticks survive paging and searching; confirming hands the chosen collections
 * back for the caller to stage in its draft.
 */
export function CollectionPickerModal({
  title,
  confirmVerb,
  alreadyIds,
  onClose,
  onConfirm,
  setError,
}: {
  title: string;
  /** "Add" → the button reads "Add 3 collections". */
  confirmVerb: string;
  /** Collections already in the list being edited — left out so they can't be picked twice. */
  alreadyIds: ReadonlySet<number>;
  onClose: () => void;
  onConfirm: (collections: CollectionChoice[]) => void;
  setError: (e: ClassifiedError) => void;
}) {
  const [all, setAll] = useState<CollectionChoice[] | null>(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());

  useEffect(() => {
    apiFetch<{ items: CollectionChoice[] }>('/v1/shopify/activation/collections/search')
      .then((res) => setAll(res.items))
      .catch((err) => {
        setAll([]);
        setError(classifyError(err));
      });
  }, [setError]);

  const matching = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (all ?? []).filter(
      (c) => !alreadyIds.has(c.shopifyCollectionId) && c.title.toLowerCase().includes(needle),
    );
  }, [all, alreadyIds, query]);

  const pageItems = matching.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pageIds = pageItems.map((c) => c.shopifyCollectionId);
  const pageSelectedCount = pageIds.filter((id) => selected.has(id)).length;

  function setMany(ids: number[], selecting: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (selecting) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function handleSelectionChange(
    type: IndexTableSelectionType,
    selecting: boolean,
    arg?: string | [number, number],
  ) {
    if (type === IndexTableSelectionType.Single) {
      setMany([Number(arg)], selecting);
    } else if (type === IndexTableSelectionType.Multi || type === IndexTableSelectionType.Range) {
      const [from, to] = arg as [number, number];
      setMany(pageIds.slice(from, to + 1), selecting);
    } else {
      // Page (the header checkbox). There is no "all matching" banner to answer.
      setMany(pageIds, selecting);
    }
  }

  const count = selected.size;

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      primaryAction={{
        content:
          count > 0 ? `${confirmVerb} ${count} collection${count === 1 ? '' : 's'}` : confirmVerb,
        disabled: count === 0,
        onAction: () => onConfirm((all ?? []).filter((c) => selected.has(c.shopifyCollectionId))),
      }}
      secondaryActions={[{ content: 'Cancel', onAction: onClose }]}
    >
      <Modal.Section>
        <BlockStack gap="300">
          <TextField
            label="Search collections"
            labelHidden
            autoComplete="off"
            placeholder="Search collections by name"
            value={query}
            onChange={(v) => {
              setQuery(v);
              setPage(1);
            }}
            clearButton
            onClearButtonClick={() => {
              setQuery('');
              setPage(1);
            }}
          />
          <Text as="p" tone="subdued">
            {count} of {matching.length} collection{matching.length === 1 ? '' : 's'} selected
          </Text>
          <IndexTable
            resourceName={{ singular: 'collection', plural: 'collections' }}
            itemCount={pageItems.length}
            selectedItemsCount={pageSelectedCount}
            onSelectionChange={handleSelectionChange}
            loading={all === null}
            headings={[{ title: 'Collection' }]}
            pagination={{
              hasPrevious: page > 1,
              hasNext: page * PAGE_SIZE < matching.length,
              onPrevious: () => setPage((p) => Math.max(1, p - 1)),
              onNext: () => setPage((p) => p + 1),
            }}
          >
            {pageItems.map((c, index) => (
              <IndexTable.Row
                id={String(c.shopifyCollectionId)}
                key={c.shopifyCollectionId}
                position={index}
                selected={selected.has(c.shopifyCollectionId)}
              >
                <IndexTable.Cell>
                  <Text as="span" fontWeight="semibold">
                    {c.title}
                  </Text>
                </IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
