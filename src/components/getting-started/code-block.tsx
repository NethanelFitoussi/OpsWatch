import { CopyButton } from '@/components/copy-button';

export function CodeBlock({ label, value }: { label: string; value: string }) {
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
