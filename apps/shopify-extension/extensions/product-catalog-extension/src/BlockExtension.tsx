import {
  AdminBlock,
  Button,
  Modal,
  reactExtension,
  useApi,
} from '@shopify/ui-extensions-react/admin';
import { useState } from 'react';

const TARGET = 'admin.product-details.block.render';

// TODO(deploy): PLACEHOLDER — replace with the real `apps/shopify` deployment URL
// before this ships. Use the `application_url` from `shopify.app.dev.toml` for
// local/dev iteration, and the `application_url` from `shopify.app.toml` for
// production. Do NOT deploy with this placeholder value in place.
const CATALOG_GENERATE_BASE_URL = 'https://REPLACE_WITH_AIVASTRA_SHOPIFY_APP_URL.invalid';

export default reactExtension(TARGET, () => <ProductCatalogBlock />);

function ProductCatalogBlock() {
  const { data } = useApi(TARGET);
  const [open, setOpen] = useState(false);
  const productId = data?.selected?.[0]?.id?.split('/').pop() ?? '';

  return (
    <AdminBlock title="AiVastra catalog images">
      <Button onClick={() => setOpen(true)} disabled={!productId}>
        Generate catalog images
      </Button>
      {open && (
        <Modal
          id="aivastra-catalog-generate-modal"
          src={`${CATALOG_GENERATE_BASE_URL}/catalog-generate?productId=${productId}`}
          title="Generate catalog images"
          onHide={() => setOpen(false)}
        />
      )}
    </AdminBlock>
  );
}
