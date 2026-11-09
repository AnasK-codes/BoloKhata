import { notFound } from 'next/navigation';
import { TurnLab } from './TurnLab';

/** Developer page that runs a whole turn against a gateway. Not shipped in production builds. */
export default function DevTurnPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <TurnLab />;
}
