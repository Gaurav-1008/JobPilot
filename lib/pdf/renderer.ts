import { PdfError } from "@/lib/pdf/errors";

/**
 * HTML → PDF via headless Chromium (Playwright).
 *
 * Kept behind this single function so the rest of the app is renderer-agnostic.
 * On serverless (e.g. Vercel) swap the launch for `playwright-core` +
 * `@sparticuz/chromium`; the signature stays the same (see PDF_RENDERER env).
 */
export async function htmlToPdf(html: string): Promise<Buffer> {
  // Dynamic import so Playwright is never bundled into the client or edge runtime.
  const { chromium } = await import("playwright");

  let browser;
  try {
    browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });
    return Buffer.from(pdf);
  } catch (err) {
    throw new PdfError(
      "PDF_RENDER_FAILED",
      "Failed to render PDF. Ensure Chromium is installed (npm run pdf:install).",
      err,
    );
  } finally {
    await browser?.close();
  }
}
