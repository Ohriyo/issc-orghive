import { Hash, Mail } from 'lucide-react';
import { Reveal } from '@/components/reveal';
import { ISSC_CONTACT } from '../contact';

export function ContactFooter() {
  return (
    <footer className="relative mx-auto max-w-7xl px-4 pt-6 pb-10 sm:px-8">
      <Reveal className="flex flex-col gap-6 sm:flex-row sm:items-end sm:gap-24">
        <div>
          <h2 className="text-body font-bold text-ink">Contact us:</h2>
          <ul className="mt-3 space-y-3 text-small text-ink">
            <li className="flex items-center gap-3">
              <span className="grid size-8 place-items-center rounded-full bg-ink text-white">
                <Mail aria-hidden="true" className="size-4" />
              </span>
              <span>
                <span className="sr-only">{ISSC_CONTACT.email.label}: </span>
                {ISSC_CONTACT.email.value}
              </span>
            </li>
            <li className="flex items-center gap-3">
              <span className="grid size-8 place-items-center rounded-full bg-ink text-white">
                <Hash aria-hidden="true" className="size-4" />
              </span>
              <span>
                <span className="sr-only">{ISSC_CONTACT.phone.label}: </span>
                {ISSC_CONTACT.phone.value}
              </span>
            </li>
          </ul>
        </div>
        <p className="max-w-48 text-small text-ink sm:pb-10">{ISSC_CONTACT.facebookPage}</p>
      </Reveal>
    </footer>
  );
}
