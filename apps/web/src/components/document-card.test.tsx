import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { DocumentCard, DocumentCardSkeleton, type DocumentCardProps } from './document-card';

const base: DocumentCardProps = {
  title: 'First semester accomplishment report',
  typeLabel: 'Accomplishment report',
  date: '2026-10-12',
  href: '/documents/1',
  fileType: 'pdf',
};

function renderCard(props: Partial<DocumentCardProps> = {}) {
  return render(
    <MemoryRouter>
      <DocumentCard {...base} {...props} />
    </MemoryRouter>,
  );
}

describe('DocumentCard', () => {
  it('is one link named after the document', () => {
    renderCard();
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(
      screen.getByRole('link', { name: 'First semester accomplishment report' }),
    ).toHaveAttribute('href', '/documents/1');
  });

  it('shows the type badge and a machine-readable date', () => {
    renderCard();
    expect(screen.getByText('Accomplishment report')).toBeInTheDocument();
    expect(screen.getByText('Oct 12, 2026')).toHaveAttribute('datetime', '2026-10-12');
  });

  it('shows the New badge only when asked', () => {
    renderCard();
    expect(screen.queryByText('New')).not.toBeInTheDocument();
    renderCard({ isNew: true });
    expect(screen.getByText('New')).toBeInTheDocument();
  });

  it('always shows the file type, and uses it as the preview when there is no thumbnail', () => {
    renderCard({ fileType: 'docx' });
    expect(screen.getAllByText('DOCX')).toHaveLength(2);
  });

  it('falls back to the file-type preview when the thumbnail fails to load', () => {
    const { container } = renderCard({ thumbnailSrc: '/broken.png' });
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).not.toBeInTheDocument();
    expect(screen.getAllByText('PDF')).toHaveLength(2);
  });

  it('uses a decorative thumbnail when one is given', () => {
    const { container } = renderCard({ thumbnailSrc: '/thumb.png' });
    expect(container.querySelector('img')).toHaveAttribute('alt', '');
  });

  it('shows the owning organization once, with its seal kept decorative', () => {
    renderCard({ org: { name: 'CSC-CEA' } });
    expect(screen.getByText('CSC-CEA')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /CSC-CEA/ })).not.toBeInTheDocument();
  });

  it('shows a status only when given, labelled in words', () => {
    renderCard();
    expect(screen.queryByText('Pending review')).not.toBeInTheDocument();
    renderCard({ status: 'pending' });
    expect(screen.getByText('Pending review')).toBeInTheDocument();
  });

  it('hides the loading skeleton from assistive technology', () => {
    const { container } = render(<DocumentCardSkeleton />);
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
  });
});
