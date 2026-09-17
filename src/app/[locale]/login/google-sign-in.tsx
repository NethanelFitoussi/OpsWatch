import { Button } from '@/components/ui/button';

/** The "Continue with Google" link and the separator above the email and password form. */
export function GoogleSignIn({ locale, label, separator }: { locale: string; label: string; separator: string }) {
  return (
    <div className="mb-4 space-y-4">
      <Button asChild variant="outline" size="lg" className="w-full">
        {/* A plain link: the start route answers with a redirect to Google, which a client navigation cannot follow. */}
        <a href={`/api/auth/google/start?locale=${locale}`}>{label}</a>
      </Button>
      <div className="flex items-center gap-3 text-xs text-muted-foreground uppercase">
        <span className="h-px flex-1 bg-border" />
        {separator}
        <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}
