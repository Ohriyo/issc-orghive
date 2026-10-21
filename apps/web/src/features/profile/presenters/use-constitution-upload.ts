import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  constitutionResponseSchema,
  contentTypeForFilename,
  manilaDate,
  MAX_UPLOAD_BYTES,
  UPLOAD_ACCEPT,
  uploadUrlResponseSchema,
} from '@orghive/shared';
import type { ActingAsModel } from '@/features/auth/presenters/use-acting-as';
import {
  constitutionDateLine,
  toConstitutionEntries,
  useConstitutionQuery,
  type ConstitutionEntry,
} from '@/features/organizations/presenters/use-constitution';
import { ACCEPTED_TYPES_LABEL } from '@/features/uploads/presenters/use-upload-documents';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { putWithProgress } from '@/lib/upload-put';
import { errorMessage } from './use-profile-editor';

export type ConstitutionUploadStep =
  | { status: 'idle' }
  | { status: 'uploading'; progress: number }
  | { status: 'saving' }
  | { status: 'error'; message: string };

export type ConstitutionEditorModel =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | {
      status: 'ready';
      /** False until the first one is uploaded: the next upload is the adopted text. */
      exists: boolean;
      dateLine: string | null;
      history: ConstitutionEntry[];
      readHref: string | null;
      accept: string;
      /** For the date input: no later than today in Manila. */
      today: string;
      file: File | null;
      fileError: string | undefined;
      amendedOn: string;
      note: string;
      setFile: (file: File | null) => void;
      setAmendedOn: (value: string) => void;
      setNote: (value: string) => void;
      step: ConstitutionUploadStep;
      upload: () => void;
    };

/**
 * The Constitution & By-laws section of the profile editor: what is on record (with scan
 * states the owner sees) and the upload of the adopted text or an amendment. The file goes
 * straight to storage with a pre-signed URL, then the API files it as the next version;
 * whether a note is needed, and the date rule, are the API's to decide.
 */
export function useConstitutionUpload(slug: string, actingAs: ActingAsModel): ConstitutionEditorModel {
  const queryClient = useQueryClient();
  const query = useConstitutionQuery(slug);
  const today = manilaDate(new Date());
  const [file, setFileState] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string>();
  const [amendedOn, setAmendedOn] = useState(today);
  const [note, setNote] = useState('');
  const [step, setStep] = useState<ConstitutionUploadStep>({ status: 'idle' });

  if (query.isPending) return { status: 'loading' };
  if (query.isError) return { status: 'error', retry: () => void query.refetch() };
  const constitution = query.data.constitution;

  function setFile(next: File | null) {
    setFileError(undefined);
    if (next && (!contentTypeForFilename(next.name) || next.size === 0 || next.size > MAX_UPLOAD_BYTES)) {
      setFileState(null);
      setFileError(`Use ${ACCEPTED_TYPES_LABEL}.`);
      return;
    }
    setFileState(next);
  }

  async function upload() {
    if (!file) {
      setFileError('Choose the file to upload.');
      return;
    }
    const name = actingAs.take();
    if (!name) {
      setStep({ status: 'error', message: 'Enter your name in “Acting as” before uploading.' });
      return;
    }
    try {
      setStep({ status: 'uploading', progress: 0 });
      const target = await api.post(
        `/organizations/${slug}/documents/upload-url`,
        { filename: file.name, contentType: contentTypeForFilename(file.name), sizeBytes: file.size },
        { schema: uploadUrlResponseSchema },
      );
      await putWithProgress(target.url, file, target.headers, (fraction) =>
        setStep({ status: 'uploading', progress: Math.round(fraction * 100) }),
      );
      setStep({ status: 'saving' });
      const result = await api.post(
        `/organizations/${slug}/constitution`,
        { uploadKey: target.uploadKey, actingAs: name, amendedOn, note },
        { schema: constitutionResponseSchema },
      );
      queryClient.setQueryData(queryKeys.documents.constitution(slug), result);
      await queryClient.invalidateQueries({ queryKey: ['documents'] });
      setFileState(null);
      setNote('');
      setStep({ status: 'idle' });
      toast.success(
        constitution
          ? 'Amendment uploaded. It replaces the current version once it passes the virus scan.'
          : 'Constitution uploaded. It appears on your page once it passes the virus scan.',
      );
    } catch (error) {
      setStep({ status: 'error', message: errorMessage(error) });
    }
  }

  return {
    status: 'ready',
    exists: constitution !== null,
    dateLine: constitution ? constitutionDateLine(constitution) : null,
    history: constitution ? toConstitutionEntries(constitution) : [],
    readHref: constitution ? `/documents/${constitution.documentId}` : null,
    accept: UPLOAD_ACCEPT,
    today,
    file,
    fileError,
    amendedOn,
    note,
    setFile,
    setAmendedOn,
    setNote,
    step,
    upload: () => void upload(),
  };
}
