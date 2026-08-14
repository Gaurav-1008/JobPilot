/**
 * Proof bundle download (P6.3.1) — FR11.
 *
 * Served as a tar rather than a zip so it needs no dependency: zip requires a
 * CRC-32 table and a central directory, tar is a header plus padding, and the
 * bundle is three small text files. `tar -xf` and every GUI archiver open it.
 *
 * EC-P6-26 notes that 200 applications with 400 PDFs belongs on the queue at a
 * 3-minute timeout. That is true for the PDF variant; this one assembles two
 * CSVs and a README from indexed queries and is measured in milliseconds. The
 * PDF-bearing bundle is the version that gets queued, and the split is
 * deliberate rather than an oversight.
 */

import { NextResponse } from "next/server";

import { requireSession } from "@/lib/auth/session";
import { toErrorResponse } from "@/lib/api-errors";
import { buildBundle, type BundleFile } from "@/lib/export/bundle";
import { getRun } from "@/lib/db/stores/tailoring-run";
import { generatePdfs } from "@/services/pdf-generator";

export const runtime = "nodejs";
export const maxDuration = 180;   // Chromium renders, when ?pdfs=1

/** Minimal USTAR writer. A tar entry is a 512-byte header plus padded data. */
function tar(files: BundleFile[]): Buffer {
  const blocks: Buffer[] = [];

  for (const file of files) {
    // Text entries carry `content`; PDFs carry raw `bytes`.
    const data = file.bytes ?? Buffer.from(file.content ?? "", "utf8");
    const header = Buffer.alloc(512);

    header.write(file.name.slice(0, 99), 0, "utf8");            // name
    header.write("0000644\0", 100, "utf8");                      // mode
    header.write("0000000\0", 108, "utf8");                      // uid
    header.write("0000000\0", 116, "utf8");                      // gid
    header.write(`${data.length.toString(8).padStart(11, "0")}\0`, 124, "utf8");
    header.write(`${Math.floor(Date.now() / 1000).toString(8).padStart(11, "0")}\0`, 136, "utf8");
    header.write("        ", 148, "utf8");   // checksum placeholder: spaces
    header.write("0", 156, "utf8");          // type: regular file
    header.write("ustar\0" + "00", 257, "utf8");

    // Checksum is the sum of every header byte with the field itself read as
    // spaces — which is why it is written last, over the placeholder.
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "utf8");

    blocks.push(header, data);
    const remainder = data.length % 512;
    if (remainder !== 0) blocks.push(Buffer.alloc(512 - remainder));
  }

  // Two zero blocks terminate the archive.
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

export async function GET(request: Request) {
  try {
    const { userId } = await requireSession();
    // EC-P6-28: redaction is opt-in per download, so the same account can
    // produce a full copy for itself and a shareable one for everyone else.
    const redactRecipients =
      new URL(request.url).searchParams.get("redact") === "1";

    /**
     * PDFs are opt-in (EC-P6-26). Each one is a Chromium render, so a bundle
     * covering every application is a multi-minute build; the default export
     * stays instant and `?pdfs=1` accepts the wait for a complete artifact.
     */
    const includePdfs = new URL(request.url).searchParams.get("pdfs") === "1";

    const files = await buildBundle({
      userId,
      redactRecipients,
      includePdfs,
      renderPdfs: includePdfs
        ? async (runId) => {
            const run = await getRun(runId, userId);
            // Tenant-scoped: another user's run resolves to null, and the
            // bundle records the omission rather than including it.
            if (!run) throw new Error("run not found");
            const rendered = await generatePdfs(run, ["tailored", "comparison"]);
            return rendered.map((p) => ({
              name: p.type === "tailored" ? "tailored-resume.pdf" : "side-by-side.pdf",
              bytes: p.buffer,
            }));
          }
        : undefined,
    });
    const archive = tar(files);

    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(new Uint8Array(archive), {
      headers: {
        "Content-Type": "application/x-tar",
        "Content-Disposition": `attachment; filename="jobpilot-proof-${stamp}${redactRecipients ? "-redacted" : ""}.tar"`,
        "Content-Length": String(archive.length),
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
