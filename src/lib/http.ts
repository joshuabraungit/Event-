import { NextResponse } from "next/server";
import type { z } from "zod";
import { formatZodError } from "./validation";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function notFound(what = "Not found") {
  return NextResponse.json({ error: what }, { status: 404 });
}

export function badRequest(error: string, fields?: Record<string, string>) {
  return NextResponse.json({ error, fields }, { status: 400 });
}

export async function parseBody<T extends z.ZodType>(req: Request, schema: T): Promise<{ data: z.infer<T> } | { error: Response }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { error: badRequest("Request body must be JSON") };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { error: badRequest("Please fix the highlighted fields", formatZodError(parsed.error)) };
  return { data: parsed.data };
}
