import { Badge } from "@/components/ui/badge";
import type { WorkflowTag } from "@/types";

const TAG_CONFIG: Record<
  WorkflowTag,
  { label: string; variant: "default" | "secondary" | "destructive" | "success" | "warning" | "info" | "outline" }
> = {
  duplicate_review:      { label: "Duplicate Review",      variant: "default" },    // violet
  needs_compression:     { label: "Needs Compression",     variant: "warning" },    // orange
  missing_metadata:      { label: "Missing Metadata",      variant: "destructive" },// red
  already_worked_on:     { label: "Already Worked On",     variant: "success" },    // green
  already_in_database:   { label: "Already In DB",         variant: "info" },       // blue
  orchard_source:        { label: "Orchard Source",        variant: "secondary" },
  wav_source:            { label: "WAV Source",            variant: "secondary" },
  tamasha_owned:         { label: "Tamasha Owned",         variant: "secondary" },
  signed_artist:         { label: "Signed Artist",         variant: "secondary" },
  catalogue_number_only: { label: "Catalogue # Only",      variant: "secondary" },
  metadata_review:       { label: "Metadata Review",       variant: "outline" },
};

interface WorkflowTagBadgeProps {
  tag: WorkflowTag;
  className?: string;
}

export function WorkflowTagBadge({ tag, className }: WorkflowTagBadgeProps) {
  const config = TAG_CONFIG[tag] ?? { label: tag, variant: "secondary" as const };
  return (
    <Badge variant={config.variant} className={className}>
      {config.label}
    </Badge>
  );
}

interface WorkflowTagListProps {
  tags: WorkflowTag[];
  max?: number;
}

export function WorkflowTagList({ tags, max = 3 }: WorkflowTagListProps) {
  const visible = tags.slice(0, max);
  const remaining = tags.length - visible.length;
  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((tag) => (
        <WorkflowTagBadge key={tag} tag={tag} />
      ))}
      {remaining > 0 && (
        <Badge variant="outline">+{remaining}</Badge>
      )}
    </div>
  );
}
