import { json } from "@/lib/http";
import { providerSummaries } from "@/lib/providers/registry";

export async function GET() {
  return json({ providers: providerSummaries() });
}
