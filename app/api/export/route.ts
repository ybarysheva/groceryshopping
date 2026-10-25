import { buildExportJson, buildExportText } from "@/lib/format";
import { json, read } from "@/lib/http";
import { readList } from "@/lib/repo";

export const dynamic = "force-dynamic";

// Stable, public, read-only. This is how Claude reads the order. See README before changing.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

export const GET = read(async (req: Request) => {
  const data = await readList();
  if (new URL(req.url).searchParams.get("format") === "text") {
    return new Response(buildExportText(data), {
      headers: {
        ...CORS,
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store, max-age=0",
      },
    });
  }
  return json(buildExportJson(data), 200, CORS);
});

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
