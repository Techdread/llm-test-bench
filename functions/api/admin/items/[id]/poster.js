// POST /api/admin/items/<id>/poster — replace the poster (multipart field `poster`).
import { replacePoster, AdminError } from '../../../../lib/admin-store.js';
import { adminRoute, fileBytes } from '../../../../lib/admin-http.js';
import { json } from '../../../../lib/http.js';

export const onRequestPost = adminRoute(async ({ env, params, request, actor, now }) => {
  let form;
  try {
    form = await request.formData();
  } catch {
    throw new AdminError(400, 'expects multipart/form-data');
  }
  const item = await replacePoster(env.DB, env.MEDIA, String(params.id), await fileBytes(form.get('poster')), { actor, now });
  return json({ item });
});
