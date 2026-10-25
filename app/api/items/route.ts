import { json, readBody, write } from "@/lib/http";
import { createItem } from "@/lib/repo";
import { itemFields, type ItemFields } from "@/lib/validate";

export const dynamic = "force-dynamic";

export const POST = write(async (req: Request) => {
  const fields = itemFields(await readBody(req), false);
  if (!fields.ok) return json({ error: fields.error }, 400);
  return json({ item: await createItem(fields.value as ItemFields) }, 201);
});
