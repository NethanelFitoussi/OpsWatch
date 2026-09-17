import { Suspense, type ReactNode } from 'react';
import { CardSkeleton } from './card-skeleton';

/** Streams one card: its skeleton shows until the AWS calls inside resolve, without holding the rest of the page. */
export function SuspenseCard({
  title,
  variant,
  rows,
  children,
}: {
  title: string;
  variant: 'table' | 'chart' | 'stat';
  rows?: number;
  children: ReactNode;
}) {
  return <Suspense fallback={<CardSkeleton title={title} variant={variant} rows={rows} />}>{children}</Suspense>;
}
