import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BulletChangeCard } from "@/components/BulletChangeCard";
import type { TailoredResume } from "@/lib/schemas";

interface SideBySideDiffProps {
  tailored: TailoredResume;
}

/** Original vs tailored bullets grouped by role, with per-bullet metadata. */
export function SideBySideDiff({ tailored }: SideBySideDiffProps) {
  return (
    <div className="space-y-6">
      {tailored.tailoredSummary && (
        <Card>
          <CardHeader>
            <CardTitle>Tailored summary</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{tailored.tailoredSummary}</p>
          </CardContent>
        </Card>
      )}

      {tailored.tailoredExperience.map((role, idx) => (
        <Card key={`${role.company}-${idx}`}>
          <CardHeader>
            <CardTitle>{role.title}</CardTitle>
            <p className="text-sm text-muted-foreground">{role.company}</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {role.bullets.map((bullet, i) => (
              <BulletChangeCard key={i} bullet={bullet} />
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
