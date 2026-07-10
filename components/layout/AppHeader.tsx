import Link from "next/link";
import { Wand2 } from "lucide-react";

/** Top navigation bar. */
export function AppHeader() {
  return (
    <header className="border-b border-border bg-card/60 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
            <Wand2 className="size-4" />
          </span>
          Resume Shapeshifter
        </Link>
        <Link
          href="/tailor"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Start tailoring →
        </Link>
      </div>
    </header>
  );
}
