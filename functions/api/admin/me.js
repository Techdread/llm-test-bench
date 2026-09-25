// GET /api/admin/me — who the console is signed in as.
import { json } from '../../lib/http.js';

export const onRequestGet = ({ data }) => json({ email: data.admin.email });
