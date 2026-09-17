import { cn } from '@/lib/utils';

/** A guide heading with an optional introduction: `h2` for page sections, `h3` for a method within one. */
export function SectionHeading({ as: Heading, id, title, intro }: { as: 'h2' | 'h3'; id?: string; title: string; intro?: string }) {
  return (
    <>
      <Heading id={id} className={cn('font-semibold tracking-tight', Heading === 'h2' ? 'text-2xl' : 'text-xl')}>
        {title}
      </Heading>
      {intro && <p className="mt-2 max-w-3xl text-muted-foreground">{intro}</p>}
    </>
  );
}
