import { json, read } from "@/lib/http";
import { readList } from "@/lib/repo";

export const dynamic = "force-dynamic";

export const GET = read(async () => json(await readList()));
