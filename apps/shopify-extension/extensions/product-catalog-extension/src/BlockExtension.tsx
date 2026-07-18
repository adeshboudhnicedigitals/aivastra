import { AdminBlock, Link, reactExtension, Text, useApi } from '@shopify/ui-extensions-react/admin';

const TARGET = 'admin.product-details.block.render';

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
      <Link href={`app:catalog-generate?productId=${productId}`} target="_self">
        Generate catalog images
      </Link>
    </AdminBlock>
  );
}
