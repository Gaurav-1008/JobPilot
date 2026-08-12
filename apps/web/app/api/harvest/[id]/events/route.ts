import Redis from "ioredis";

import { getSession } from "@/lib/auth/session";
import { getHarvestRun } from "@/lib/db/stores/harvest";

export const runtime = "nodejs";

/**
 * GET /api/harvest/:id/events — SSE progress (P2.3.3).
 *
 * EC-P2-46: a stream is a route. It is authorised like any other.
 * EC-P2-47: the current durable state is sent IMMEDIATELY on connect, before
 *           any deltas — otherwise a client that subscribes after the run
 *           finished sees nothing at all.
 * EC-P2-41: X-Accel-Buffering disables proxy buffering. Without it nginx holds
 *           the whole stream until completion and "live progress" silently
 *           becomes one update at the end.
 */
export async function GET(_r: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const run = await getHarvestRun(id, session.userId);
  if (!run) return new Response("Not found", { status: 404 });

  const sub = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

      send({ type: "snapshot", status: run.status, boardResults: run.boardResults });

      await sub.subscribe(`harvest:${id}`);
      sub.on("message", (_ch, msg) => {
        try { send({ type: "progress", ...JSON.parse(msg) }); } catch { /* ignore */ }
      });

      // Bounded lifetime: the client falls back to polling (EC-P2-42).
      const timer = setTimeout(() => { void sub.quit(); controller.close(); }, 5 * 60_000);
      // @ts-expect-error - cleanup handle for cancel()
      controller._cleanup = () => { clearTimeout(timer); void sub.quit(); };
    },
    cancel(reason) {
      void sub.quit();
      void reason;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",   // EC-P2-41
    },
  });
}
