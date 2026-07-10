import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { JobDescriptionProfile } from "@/lib/schemas";

interface JDRequirementsSummaryProps {
  jd: JobDescriptionProfile;
}

function ChipRow({
  label,
  items,
  variant = "secondary",
}: {
  label: string;
  items: string[];
  variant?: "default" | "secondary" | "outline";
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <Badge key={item} variant={variant}>
            {item}
          </Badge>
        ))}
      </div>
    </div>
  );
}

/** Extracted JD requirements: title, skills, tools, seniority. */
export function JDRequirementsSummary({ jd }: JDRequirementsSummaryProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{jd.jobTitle}</CardTitle>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {jd.company && <span>{jd.company}</span>}
          {jd.seniorityLevel && (
            <Badge variant="outline">{jd.seniorityLevel}</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <ChipRow label="Required skills" items={jd.requiredSkills} variant="default" />
        <ChipRow label="Preferred skills" items={jd.preferredSkills} />
        <ChipRow label="Tools" items={jd.tools} variant="outline" />
        <ChipRow label="Keywords" items={jd.keywords} variant="outline" />
      </CardContent>
    </Card>
  );
}
