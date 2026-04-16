# POST /api/v2/orders

## Request

All fields are required unless marked optional.

- `customer_id` (string) — the customer placing the order
- `items` (array) — list of line items
- `shipping_address` (object, optional) — delivery address
- `notes` (string, optional) — free-text order notes

## Behavior

The endpoint creates an order and returns the full order object.
Orders may be modified after creation via PATCH.
The system should send a confirmation email on success.

## Rate Limits

This endpoint is not rate-limited during the beta period.
