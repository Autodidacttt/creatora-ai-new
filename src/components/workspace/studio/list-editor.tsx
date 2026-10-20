"use client";

import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";

/** Editable list of short lines (deliverables, requirements, do/don't…). */
export function ListEditor({ value, onChange, placeholder, max = 12, label }: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  max?: number;
  label: string;
}) {
  return (
    <div className="space-y-2">
      {value.map((item, i) => (
        <div key={i} className="flex gap-2">
          <Input value={item} aria-label={`${label} ${i + 1}`} placeholder={placeholder} maxLength={240}
            onChange={(e) => onChange(value.map((v, j) => (j === i ? e.target.value : v)))} />
          <Button size="icon" variant="ghost" aria-label={`Remove ${label.toLowerCase()} ${i + 1}`} onClick={() => onChange(value.filter((_, j) => j !== i))}><X /></Button>
        </div>
      ))}
      {value.length < max && (
        <Button size="sm" variant="ghost" onClick={() => onChange([...value, ""])}><Plus /> Add {label.toLowerCase()}</Button>
      )}
    </div>
  );
}
