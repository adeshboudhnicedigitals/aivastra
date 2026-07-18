import { AppError } from '../../lib/errors.js';
import { shopifyAdminFetch } from './service.js';

interface ProductCreateMediaResponse {
  data?: {
    productCreateMedia?: {
      media: { id: string }[];
      mediaUserErrors: { message: string }[];
    };
  };
  errors?: { message: string }[];
}

const MUTATION = `
  mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media { id }
      mediaUserErrors { message }
    }
  }
`;

/** Attaches an image (by URL — Shopify fetches it server-side) to a product's
 *  media gallery via the Admin GraphQL API. Throws on any GraphQL-level or
 *  mediaUserErrors failure so the caller can surface a clear error instead of
 *  silently returning no media. */
export async function createProductMedia(
  shopDomain: string,
  accessToken: string,
  shopifyProductId: number,
  imageUrl: string,
): Promise<string> {
  const res = await shopifyAdminFetch(shopDomain, accessToken, '/graphql.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: MUTATION,
      variables: {
        productId: `gid://shopify/Product/${shopifyProductId}`,
        media: [{ originalSource: imageUrl, mediaContentType: 'IMAGE' }],
      },
    }),
  });
  if (!res.ok) {
    throw new AppError('SHOPIFY', 502, `Shopify GraphQL request failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as ProductCreateMediaResponse;
  if (body.errors?.length) {
    throw new AppError('SHOPIFY', 502, body.errors[0].message);
  }
  const result = body.data?.productCreateMedia;
  if (!result || result.mediaUserErrors.length > 0) {
    throw new AppError(
      'SHOPIFY',
      502,
      result?.mediaUserErrors[0]?.message ?? 'productCreateMedia failed',
    );
  }
  const media = result.media[0];
  if (!media) {
    throw new AppError('SHOPIFY', 502, 'productCreateMedia returned no media');
  }
  return media.id;
}
