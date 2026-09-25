// Every /api/admin/* request: verify the Cloudflare Access identity (and the
// CSRF header on writes) before any route runs. See lib/access.js.
import { authorizeAdmin } from '../../lib/access.js';
import { adminError } from '../../lib/admin-http.js';

export async function onRequest(context) {
  try {
    context.data.admin = await authorizeAdmin(context.request, context.env);
  } catch (error) {
    return adminError(error);
  }
  const response = await context.next();
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
