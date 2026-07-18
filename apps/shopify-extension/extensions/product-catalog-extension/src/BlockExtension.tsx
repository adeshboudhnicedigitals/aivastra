import { AdminBlock, Link, reactExtension, Text, useApi } from '@shopify/ui-extensions-react/admin';

const TARGET = 'admin.product-details.block.render';

// TODO(deploy): PLACEHOLDER — replace with the real `apps/shopify` deployment URL
// before this ships. Use the `application_url` from `shopify.app.dev.toml` for
// local/dev iteration, and the `application_url` from `shopify.app.toml` for
// production. Do NOT deploy with this placeholder value in place.
const CATALOG_GENERATE_BASE_URL = 'https://REPLACE_WITH_AIVASTRA_SHOPIFY_APP_URL.invalid';

export default reactExtension(TARGET, () => <ProductCatalogBlock />);

function ProductCatalogBlock() {
  const { data } = useApi(TARGET);
  const productId = data?.selected?.[0]?.id?.split('/').pop() ?? '';

  if (!productId) {
    return (
      <AdminBlock title="AiVastra catalog images">
        <Text>Save the product to generate catalog images.</Text>
      </AdminBlock>
    );
  }

  return (
    <AdminBlock title="AiVastra catalog images">
      <Link
        href={`${CATALOG_GENERATE_BASE_URL}/catalog-generate?productId=${productId}`}
        target="_blank"
      >
        Generate catalog images
      </Link>
    </AdminBlock>
  );
}
