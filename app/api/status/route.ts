import { json, readBody, write } from "@/lib/http";
import { setStatus } from "@/lib/repo";

export const dynamic = "force-dynamic";

export const PUT = write(async (req: Request) => {
  const body = await readBody(req);
  if (body.status !== "final" && body.status !== "draft") {
    return json({ error: 'status must be "final" or "draft".' }, 400);
  }
  return json(await setStatus(body.status));
});
