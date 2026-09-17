import { CopyButton } from '@/components/copy-button';

/** A copyable block of code: compact without a label, or framed with the label in a header bar. */
export function CodeBlock({ label, value }: { label?: string; value: string }) {
  if (!label) {
    return (
      <div className="flex items-start gap-2">
        <pre className="min-w-0 flex-1 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">{value}</pre>
        <CopyButton value={value} />
      </div>
    );
  }
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border bg-muted/40">
      <div className="flex items-center justify-between gap-2 border-b bg-muted/60 py-1 pr-1 pl-3">
        <span className="truncate font-mono text-xs text-muted-foreground">{label}</span>
        <CopyButton value={value} />
      </div>
      <pre className="max-h-80 overflow-auto p-3 font-mono text-xs leading-relaxed">
        <code>{value}</code>
      </pre>
    </div>
  );
}
