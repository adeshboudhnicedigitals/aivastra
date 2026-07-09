UPDATE shopify_stores s
SET store_key = wc.widget_key,
    allowed_origins = wc.allowed_origins
FROM widget_clients wc
WHERE s.widget_client_id = wc.id;
