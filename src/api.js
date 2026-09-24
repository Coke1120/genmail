export async function api(path, options = {}) {
  const { account, ...request } = options;
  const response = await fetch(`/api${path}`, { ...request, headers: { 'Content-Type': 'application/json', 'X-Morrow-View': 'paged', ...(account ? { 'X-Genmail-Account': typeof account === 'string' ? account : account.id || (account.mode === 'demo' ? 'demo' : account.email) } : {}), ...request.headers } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.error || `Request failed (${response.status}). Please try again.`), { status: response.status, requiresSendReview: result.requiresSendReview, draftId: result.draftId, deliveryRequestId: result.deliveryRequestId, messageRecord: result.message });
  return result;
}
