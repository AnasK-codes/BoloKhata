import { notFound } from 'next/navigation';
import { AudioLab } from './AudioLab';

/** Developer page for checking the audio layer by ear and by eye. Not shipped in production builds. */
export default function DevAudioPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <AudioLab />;
}
