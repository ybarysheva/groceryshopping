import { json, readBody, write } from "@/lib/http";
import { deleteItem, updateItem } from "@/lib/repo";
import { ID_PATTERN, itemFields } from "@/lib/validate";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = write(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  if (!ID_PATTERN.test(id)) return json({ error: "Unknown item." }, 404);
  const fields = itemFields(await readBody(req), true);
  if (!fields.ok) return json({ error: fields.error }, 400);
  if (Object.keys(fields.value).length === 0) return json({ error: "Nothing to change." }, 400);
  return json({ item: await updateItem(id, fields.value) });
});

export const DELETE = write(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  if (!ID_PATTERN.test(id)) return json({ error: "Unknown item." }, 404);
  await deleteItem(id);
  return json({ ok: true });
});
