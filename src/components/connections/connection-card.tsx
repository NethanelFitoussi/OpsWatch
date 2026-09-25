import { ChevronRight, Cloud, CloudCog, Droplet, GitBranch, Globe, KeyRound, Sparkles, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import type { IntegrationId } from '@/lib/integrations/catalogue';
import { TONE_SOFT } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';

/**
 * One card for everything OpsWatch is, or could be, connected to.
 *
 * Accounts, the provider chooser and the Integrations page each used to draw their own: an AWS account was
 * a card, GitHub was a line of text, and the same connection read as three different kinds of thing
 * depending on which page you arrived from. They share this one now, and the measured state behind it —
 * so a card can differ in how much is known about it, and in nothing else.
 *
 * It is presentational on purpose: every word arrives as a prop, already translated by the page. No
 * credential, no status and no database reaches it.
 */

/** The colour of the state pill. `neutral` is "nothing measured", which is not a failure. */
export type ConnectionTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const PILL: Record<ConnectionTone, string> = {
  success: TONE_SOFT.success,
  warning: TONE_SOFT.warning,
  danger: TONE_SOFT.danger,
  info: TONE_SOFT.info,
  neutral: 'bg-muted text-muted-foreground',
};

/** One glyph per provider, so a wall of cards is scannable before any of it is read. */
const PROVIDER_ICONS: Record<IntegrationId, LucideIcon> = {
  aws: Cloud,
  gcp: CloudCog,
  do: Droplet,
  github: GitBranch,
  ai: Sparkles,
  cloudflare: Globe,
  google: KeyRound,
};

/** A measured `label: value` pair on the face of a card. Never a credential. */
export type ConnectionFact = { label: string; value: string };

export function ConnectionCard({
  integration,
  scope = 'integration',
  state,
  provider,
  tone,
  stateLabel,
  title,
  facts = [],
  badges,
  notes,
  href,
  actionLabel,
  secondary,
  hint,
}: {
  /** The provider, for the cross-page checks that these screens never disagree. */
  integration: IntegrationId;
  /**
   * Which thing the card stands for. `integration` is the provider as a whole, and its `state` is one of
   * the four measured `IntegrationState`s. `connection` is one account inside a provider, whose `state` is
   * that account's own last permission test — a different vocabulary, which is why it is a different
   * scope rather than the same attribute meaning two things.
   */
  scope?: 'integration' | 'connection';
  /** The measured state, in the vocabulary `scope` names. */
  state: string;
  provider: string;
  tone: ConnectionTone;
  stateLabel: string;
  title: string;
  facts?: readonly ConnectionFact[];
  badges?: ReactNode;
  notes?: ReactNode;
  /**
   * Where managing or connecting it happens. `null` means there is nowhere real to go — either because
   * this build cannot complete it, which `hint` explains, or because it is configured outside OpsWatch
   * and the card's own detail already says so.
   */
  href: string | null;
  actionLabel: string;
  /** A second link, such as the guide. It sits above the card's own link rather than inside it. */
  secondary?: ReactNode;
  hint?: string;
}) {
  const Icon = PROVIDER_ICONS[integration];

  return (
    <Card
      data-integration={integration}
      data-scope={scope}
      data-state={state}
      className={cn(
        'relative h-full gap-3 transition-shadow hover:shadow-md focus-within:ring-2 focus-within:ring-ring',
        href === null && 'border border-dashed bg-transparent ring-0',
      )}
    >
      <CardHeader className="gap-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex min-w-0 items-center gap-2 text-base font-semibold">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Icon className="size-4" aria-hidden />
              {/* The glyph says which provider; this is the same thing said out loud. */}
              <span className="sr-only">{provider}</span>
            </span>
            {href === null ? (
              <span className="truncate">{title}</span>
            ) : (
              // The whole card is the target; the title is what carries the name and the focus ring.
              <Link href={href} className="truncate rounded-sm after:absolute after:inset-0 focus-visible:outline-none">
                {title}
                {/* What following it does. Listed among a page's links, "GitHub" alone does not say. */}
                <span className="sr-only"> — {actionLabel}</span>
              </Link>
            )}
          </CardTitle>
          {/* Not `shrink-0`: a state label is a sentence in some languages — French says "Configuration
              incomplète" where English says "Draft" — and a pill that refuses to give way pushes the
              whole card off the side of a 360px screen. It yields and wraps; the title truncates. */}
          <span className={cn('mt-1 min-w-0 rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide break-words uppercase', PILL[tone])}>
            {stateLabel}
          </span>
        </div>
        {badges}
      </CardHeader>

      {(notes !== undefined || facts.length > 0) && (
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          {notes}
          {facts.length > 0 && (
            <dl className="space-y-1">
              {facts.map((fact) => (
                <div key={fact.label} className="flex gap-2">
                  <dt className="shrink-0">{fact.label}</dt>
                  <dd className="min-w-0 truncate text-foreground">{fact.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </CardContent>
      )}

      {(href !== null || hint !== undefined || secondary !== undefined) && (
      <CardContent className="mt-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-1 pt-1">
        {href === null ? (
          hint !== undefined && <span className="text-sm text-muted-foreground">{hint}</span>
        ) : (
          // Said once, to a screen reader, in the link above; here it is the same word drawn.
          <span className="flex items-center gap-1 text-sm font-medium text-primary" aria-hidden>
            {actionLabel}
            <ChevronRight className="size-4" />
          </span>
        )}
        {secondary !== undefined && <span className="relative z-10 text-sm">{secondary}</span>}
      </CardContent>
      )}
    </Card>
  );
}
