# POST /api/v2/orders

## Request

All fields are required unless marked optional.

- `customer_id` (string) — the customer placing the order
- `items` (array) — list of line items, limited to 50 per request
- `shipping_address` (object) — delivery address
- `notes` (string, optional) — free-text order notes, max 500 characters
- `idempotency_key` (string) — unique key to prevent duplicate orders

## Behavior

The endpoint creates an order and returns the order ID only.
Orders are immutable after creation; use POST /api/v2/orders/{id}/amendments.
The system must send a confirmation email and a webhook event on success.

## Rate Limits

This endpoint is rate-limited to 100 requests per minute per customer.
Requests exceeding the limit receive a 429 response with a Retry-After header.
