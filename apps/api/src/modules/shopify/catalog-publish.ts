import { AppError } from '../../lib/errors.js';
import { assertNoUserErrors, type GraphQLUserError, shopifyGraphQL, toGid } from './service.js';

interface ProductCreateMediaData {
  productCreateMedia?: {
    media: { id: string }[];
    mediaUserErrors: GraphQLUserError[];
  };
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
  const data = await shopifyGraphQL<ProductCreateMediaData>(shopDomain, accessToken, MUTATION, {
    productId: toGid('Product', shopifyProductId),
    media: [{ originalSource: imageUrl, mediaContentType: 'IMAGE' }],
  });

  const result = data.productCreateMedia;
  if (!result) {
    throw new AppError('SHOPIFY', 502, 'productCreateMedia missing from response');
  }
  assertNoUserErrors(result.mediaUserErrors, 'productCreateMedia');

  const media = result.media[0];
  if (!media) {
    throw new AppError('SHOPIFY', 502, 'productCreateMedia returned no media');
  }
  return media.id;
}
